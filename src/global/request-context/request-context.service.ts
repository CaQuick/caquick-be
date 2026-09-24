import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

/** transport(HTTP) 계층에서만 알 수 있는 값이라 도메인 서비스 시그니처를 오염시키지 않고 AsyncLocalStorage로 암묵 전파한다. */
export interface RequestContextStore {
  clientIp?: string;
  userAgent?: string;
  /** 응답 헤더·tx 로그와 같은 값. 로거 포맷이 ALS에서 읽어 모든 줄에 싣는다(P2 E8). */
  requestId?: string;
  /** 이벤트 소비(worker) 중에 연다 — 발행 로그의 (requestId, eventId)와 이어 본다. */
  eventId?: string;
}

/** 로거 포맷(DI 밖)도 읽어야 해서 저장소는 모듈 싱글턴이다. 서비스는 이 위의 얇은 껍데기. */
export const requestContextStorage =
  new AsyncLocalStorage<RequestContextStore>();

/** RequestContextMiddleware가 요청 진입 시 run()으로 컨텍스트를 연다. run() 밖에서 get()은 undefined. */
@Injectable()
export class RequestContextService {
  private readonly storage = requestContextStorage;

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
