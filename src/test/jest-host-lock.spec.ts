import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';

import {
  acquireHostLock,
  type HostLock,
  shouldTakeHostLock,
} from '@/test/jest-host-lock';

/** 이 spec이 도는 jest 자체가 기본 포트의 락을 쥐고 있으므로 빈 포트를 따로 받는다. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** 정해진 시간 안에 끝나지 않으면 'pending'. */
function settledWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | 'pending'> {
  return Promise.race([
    promise,
    new Promise<'pending'>((resolve) =>
      setTimeout(() => resolve('pending'), ms),
    ),
  ]);
}

describe('shouldTakeHostLock', () => {
  it.each([
    [{}, [], true],
    [{}, ['--ci', '--coverage'], true],
    [{}, ['--watchman'], true],
    [{}, ['--watch=false'], true],
    [{ CI: 'true' }, [], false],
    [{}, ['--watch'], false],
    [{}, ['--watchAll'], false],
    [{}, ['--watch=true'], false],
    [{}, ['--watchAll=true'], false],
  ])('env %j · argv %j → %s', (env, argv, expected) => {
    expect(shouldTakeHostLock(env, argv)).toBe(expected);
  });
});

describe('acquireHostLock', () => {
  let port: number;
  const held: HostLock[] = [];
  const children: ChildProcess[] = [];
  const log = jest.fn();

  beforeEach(async () => {
    port = await freePort();
    log.mockClear();
  });
  // 단언이 실패해도 자식이 남아 jest가 끝나지 않는 일이 없게 한다
  afterEach(async () => {
    children.splice(0).forEach((child) => child.kill('SIGKILL'));
    await Promise.all(held.splice(0).map((lock) => lock.release()));
  });

  async function take(): Promise<HostLock> {
    const lock = await acquireHostLock({ port, pollMs: 20, log });
    held.push(lock);
    return lock;
  }

  it('비어 있으면 바로 잡는다', async () => {
    await expect(settledWithin(take(), 1_000)).resolves.not.toBe('pending');
    expect(log).not.toHaveBeenCalled();
  });

  it('다른 실행이 쥐고 있으면 기다렸다가 풀리면 잡고, 기다린다는 안내는 한 번만 한다', async () => {
    const first = await take();
    const second = take();

    expect(await settledWithin(second, 300)).toBe('pending');
    await first.release();
    held.splice(held.indexOf(first), 1);

    await expect(settledWithin(second, 1_000)).resolves.not.toBe('pending');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('기다리는 실행이 둘이면 풀릴 때 하나만 잡는다', async () => {
    const first = await take();
    const waiters = [take(), take()];
    const done: number[] = [];
    waiters.forEach((waiter, i) => void waiter.then(() => done.push(i)));

    await first.release();
    held.splice(held.indexOf(first), 1);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(done).toHaveLength(1);
    const winner = await waiters[done[0]];
    await winner.release();
    held.splice(held.indexOf(winner), 1);
    await expect(settledWithin(waiters[1 - done[0]], 1_000)).resolves.not.toBe(
      'pending',
    );
  });

  it('쥐고 있던 프로세스가 강제 종료되면(SIGKILL) OS가 포트를 풀어 바로 잡는다', async () => {
    const child = spawn(process.execPath, [
      '-e',
      `require('node:net').createServer().listen({ port: ${port}, host: '127.0.0.1', exclusive: true }, () => console.log('ready')); setInterval(() => {}, 1000);`,
    ]);
    children.push(child);
    await new Promise<void>((resolve) =>
      child.stdout.once('data', () => resolve()),
    );
    const waiting = take();
    expect(await settledWithin(waiting, 300)).toBe('pending');

    child.kill('SIGKILL');

    await expect(settledWithin(waiting, 2_000)).resolves.not.toBe('pending');
  });
});
