import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

/**
 * 요청 단위로 전파되는 횡단 메타데이터.
 *
 * transport(HTTP) 계층에서만 알 수 있는 값이라 도메인 서비스 시그니처를 오염시키지 않고
 * AsyncLocalStorage 로 암묵 전파한다. 감사 로그(ip)·향후 requestId/UA 등이 여기 모인다.
 */
export interface RequestContextStore {
  clientIp?: string;
  userAgent?: string;
}

/**
 * 요청 컨텍스트 저장소(싱글톤).
 *
 * `RequestContextMiddleware` 가 요청 진입 시 `run()` 으로 컨텍스트를 연다.
 * 이후 같은 async continuation 에서 실행되는 resolver/service/repository 는
 * `get()` 으로 컨텍스트를 읽는다. run() 밖에서 호출하면 undefined.
 */
@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  /**
   * 주어진 컨텍스트로 callback 을 실행한다. callback 내부(및 그 async 후속)에서
   * `get()` 이 이 컨텍스트를 반환한다.
   */
  run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  /**
   * 현재 요청 컨텍스트. run() 밖이면 undefined.
   */
  get(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  /**
   * 현재 요청의 client IP. 없으면 undefined.
   */
  getClientIp(): string | undefined {
    return this.storage.getStore()?.clientIp;
  }

  /**
   * 현재 요청의 User-Agent. 없으면 undefined.
   */
  getUserAgent(): string | undefined {
    return this.storage.getStore()?.userAgent;
  }
}
