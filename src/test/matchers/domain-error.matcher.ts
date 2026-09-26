import { HttpException } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';

/**
 * `toThrowDomain(404)` — HttpException status 단언, `toThrowDomain('STORE_NOT_FOUND')` — 카탈로그 코드 단언.
 * 동기(`expect(() => fn()).toThrowDomain`)와 비동기(`expect(promise).rejects.toThrowDomain`) 모두 지원.
 */
function toThrowDomain(received: unknown, expected: number | string) {
  let error: unknown = received;
  if (typeof received === 'function') {
    try {
      (received as () => unknown)();
      return { pass: false, message: () => '함수가 예외를 던지지 않았다' };
    } catch (e) {
      error = e;
    }
  }
  const status = error instanceof HttpException ? error.getStatus() : undefined;
  const code = error instanceof DomainException ? error.code : undefined;
  const pass =
    typeof expected === 'number' ? status === expected : code === expected;
  const received_ = `${error instanceof Error ? error.constructor.name : typeof error}(status=${status}, code=${code}, message=${error instanceof Error ? error.message : String(error)})`;
  return {
    pass,
    message: () =>
      `expected ${typeof expected === 'number' ? `status ${expected}` : `code ${expected}`}, received ${received_}`,
  };
}

expect.extend({ toThrowDomain });

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toThrowDomain(expected: number | string): R;
    }
  }
}
