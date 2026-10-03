import { type ChildProcess, spawn } from 'node:child_process';
import { createServer, type Server, type Socket } from 'node:net';

import {
  acquireHostLock,
  DEFAULT_JEST_HOST_LOCK_PORT,
  type HostLock,
  hostLockPort,
  LOCK_BANNER,
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

describe('hostLockPort', () => {
  it.each([
    [{}, DEFAULT_JEST_HOST_LOCK_PORT],
    [{ JEST_HOST_LOCK_PORT: '50123' }, 50123],
    [{ JEST_HOST_LOCK_PORT: '' }, DEFAULT_JEST_HOST_LOCK_PORT],
    [{ JEST_HOST_LOCK_PORT: 'abc' }, DEFAULT_JEST_HOST_LOCK_PORT],
    [{ JEST_HOST_LOCK_PORT: '-1' }, DEFAULT_JEST_HOST_LOCK_PORT],
  ])('env %j → %i', (env, expected) => {
    expect(hostLockPort(env)).toBe(expected);
  });
});

describe('acquireHostLock', () => {
  let port: number;
  const held: HostLock[] = [];
  /** 테스트가 띄운 다른 서버 — 단언이 실패해도 닫아야 jest가 끝난다. */
  const servers: Server[] = [];
  const children: ChildProcess[] = [];
  const log = jest.fn();

  beforeEach(async () => {
    port = await freePort();
    log.mockClear();
  });
  afterEach(async () => {
    children.splice(0).forEach((child) => child.kill('SIGKILL'));
    await Promise.all(held.splice(0).map((lock) => lock.release()));
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
    );
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

  it.each([
    ['아무것도 보내지 않는 서버', (socket: Socket) => void socket],
    [
      '다른 내용을 보내는 서버',
      (socket: Socket) => socket.end('HTTP/1.1 200 OK\r\n\r\n'),
    ],
    ['바로 끊는 서버', (socket: Socket) => socket.end()],
  ])(
    '반증: jest가 아닌 %s가 포트를 쓰면 기다리지 않고 오류로 멈춘다',
    async (_label, onConnection) => {
      const other = createServer(onConnection);
      servers.push(other);
      await new Promise<void>((resolve) =>
        other.listen(port, '127.0.0.1', resolve),
      );

      await expect(
        settledWithin(acquireHostLock({ port, pollMs: 20, log }), 3_000),
      ).rejects.toThrow(/jest가 아닌 프로세스가 쓰고 있다/);
      expect(log).not.toHaveBeenCalled();
    },
  );

  it('락이 풀리는 순간의 끊김(RST·빈 응답)은 다른 프로세스로 오판하지 않고 재시도해 잡는다', async () => {
    // 쥔 쪽이 닫히는 중 — 첫 접속은 RST, 둘째는 빈 응답으로 끊고 포트를 놓는다
    let connections = 0;
    const releasing = createServer((socket) => {
      connections += 1;
      if (connections === 1) socket.resetAndDestroy();
      else {
        socket.end();
        releasing.close();
      }
    });
    servers.push(releasing);
    await new Promise<void>((resolve) =>
      releasing.listen(port, '127.0.0.1', resolve),
    );

    await expect(settledWithin(take(), 3_000)).resolves.not.toBe('pending');
    expect(connections).toBe(2);
  });

  it('쥐고 있던 프로세스가 강제 종료되면(SIGKILL) OS가 포트를 풀어 바로 잡는다', async () => {
    const child = spawn(process.execPath, [
      '-e',
      `require('node:net').createServer((s) => s.end('${LOCK_BANNER} 1\\n')).listen({ port: ${port}, host: '127.0.0.1', exclusive: true }, () => console.log('ready')); setInterval(() => {}, 1000);`,
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
