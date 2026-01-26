import type { Request, Response } from 'express';

/**
 * GraphQL 실행 컨텍스트 타입
 */
export interface GraphqlContext {
  req: Request;
  res?: Response;
}
