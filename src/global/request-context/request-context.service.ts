import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

/** transport(HTTP) 계층에서만 알 수 있는 값이라 도메인 서비스 시그니처를 오염시키지 않고 AsyncLocalStorage로 암묵 전파한다. */
export interface RequestContextStore {
  clientIp?: string;
  userAgent?: string;
}

/** RequestContextMiddleware가 요청 진입 시 run()으로 컨텍스트를 연다. run() 밖에서 get()은 undefined. */
@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  get(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  getClientIp(): string | undefined {
    return this.storage.getStore()?.clientIp;
  }

  getUserAgent(): string | undefined {
    return this.storage.getStore()?.userAgent;
  }
}
