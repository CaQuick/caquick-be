import { connect, createServer, type Server } from 'node:net';

/**
 * 같은 호스트의 jest 실행을 한 번에 하나로 묶는다 — testcontainers가 운영과 같은 VM을 써서 동시 실행이 부하·간헐 실패를 낳는다(guide §9).
 * 락은 127.0.0.1의 포트를 여는 것이다. 프로세스가 어떻게 끝나든(Ctrl+C·SIGKILL) OS가 포트를 풀어 남는 락이 없다.
 * 쥔 쪽은 접속에 식별 문자열을 돌려준다 — 다른 프로그램이 포트를 쓰고 있으면 jest 실행으로 오인해 끝없이 기다리지 않는다.
 */
export const DEFAULT_JEST_HOST_LOCK_PORT = 47391;
export const LOCK_BANNER = 'caquick-be-jest-lock';
const POLL_MS = 2_000;
const PROBE_TIMEOUT_MS = 1_000;
/** 락이 풀리는 순간 접속하면 RST나 빈 응답을 받는다 — 이만큼 연달아 모호해야 jest가 아닌 점유로 본다. */
const AMBIGUOUS_LIMIT = 3;
const AMBIGUOUS_RETRY_MS = 100;

export interface HostLock {
  release(): Promise<void>;
}

export interface HostLockOptions {
  port?: number;
  pollMs?: number;
  log?: (message: string) => void;
}

/** CI 러너는 실행마다 격리돼 있고, watch는 세션 내내 락을 쥐어 다른 실행을 막으므로 잡지 않는다. */
export function shouldTakeHostLock(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): boolean {
  if (env.CI) return false;
  return !argv.some((arg) => /^--watch(All)?(=true)?$/.test(arg));
}

export function hostLockPort(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env.JEST_HOST_LOCK_PORT);
  return Number.isInteger(fromEnv) && fromEnv > 0
    ? fromEnv
    : DEFAULT_JEST_HOST_LOCK_PORT;
}

function listen(port: number): Promise<Server | null> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) =>
      socket.end(`${LOCK_BANNER} ${process.pid}\n`),
    );
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(null);
      else reject(error);
    });
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      // 락이 열려 있다고 jest 프로세스가 끝나지 않으면 안 된다
      server.unref();
      resolve(server);
    });
  });
}

type Occupant = 'jest' | 'other' | 'gone' | 'ambiguous';

/** 포트를 쥔 쪽이 이 락인지 묻는다. 접속이 거절되면 그새 풀린 것이다. */
function probe(port: number): Promise<Occupant> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    let data = '';
    let settled = false;
    const done = (occupant: Occupant) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(occupant);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done('other'));
    socket.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length >= LOCK_BANNER.length) {
        done(data.startsWith(LOCK_BANNER) ? 'jest' : 'other');
      }
    });
    socket.on('end', () => {
      if (data.startsWith(LOCK_BANNER)) done('jest');
      else done(data === '' ? 'ambiguous' : 'other');
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') done('gone');
      else done(error.code === 'ECONNRESET' ? 'ambiguous' : 'other');
    });
  });
}

export async function acquireHostLock(
  options: HostLockOptions = {},
): Promise<HostLock> {
  const port = options.port ?? hostLockPort();
  const pollMs = options.pollMs ?? POLL_MS;
  const log = options.log ?? ((message: string) => console.log(message));
  let waited = false;
  let ambiguous = 0;
  for (;;) {
    const server = await listen(port);
    if (server) {
      return {
        release: () =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      };
    }
    const occupant = await probe(port);
    if (occupant === 'ambiguous' && ++ambiguous < AMBIGUOUS_LIMIT) {
      await new Promise((resolve) => setTimeout(resolve, AMBIGUOUS_RETRY_MS));
      continue;
    }
    if (occupant === 'other' || occupant === 'ambiguous') {
      throw new Error(
        `[test] 127.0.0.1:${port}를 jest가 아닌 프로세스가 쓰고 있다 — JEST_HOST_LOCK_PORT로 다른 포트를 지정한다`,
      );
    }
    if (occupant === 'gone') continue;
    ambiguous = 0;
    if (!waited) {
      log(
        `[test] 다른 jest 실행이 끝나기를 기다린다(호스트 락 127.0.0.1:${port})`,
      );
      waited = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
