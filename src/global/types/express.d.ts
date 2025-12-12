import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /**
     * 요청 상관관계 ID
     */
    requestId?: string;

    /**
     * 요청 시작 시간(ms)
     */
    startTime?: number;
  }
}
