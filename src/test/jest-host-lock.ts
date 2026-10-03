import { createServer, type Server } from 'node:net';

/**
 * 같은 호스트의 jest 실행을 한 번에 하나로 묶는다 — testcontainers가 운영과 같은 VM을 써서 동시 실행이 부하·간헐 실패를 낳는다(guide §9).
 * 락은 127.0.0.1의 고정 포트를 여는 것이다. 프로세스가 어떻게 끝나든(Ctrl+C·SIGKILL) OS가 포트를 풀어 남는 락이 없다.
 */
export const JEST_HOST_LOCK_PORT = 47391;
const POLL_MS = 2_000;

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

function listen(port: number): Promise<Server | null> {
  return new Promise((resolve, reject) => {
    const server = createServer();
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

export async function acquireHostLock(
  options: HostLockOptions = {},
): Promise<HostLock> {
  const port = options.port ?? JEST_HOST_LOCK_PORT;
  const pollMs = options.pollMs ?? POLL_MS;
  const log = options.log ?? ((message: string) => console.log(message));
  let waited = false;
  for (;;) {
    const server = await listen(port);
    if (server) {
      return {
        release: () =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      };
    }
    if (!waited) {
      log(
        `[test] 다른 jest 실행이 끝나기를 기다린다(호스트 락 127.0.0.1:${port})`,
      );
      waited = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
