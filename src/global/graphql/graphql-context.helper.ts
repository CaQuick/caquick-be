import type { IncomingMessage } from 'node:http';

import type { Request, Response } from 'express';

/**
 * HTTP·WebSocket(graphql-ws) 공용 GraphQL context 조립.
 *
 * ws 연결의 인증 토큰은 connectionParams.authorization으로 들어오므로,
 * upgrade 요청 객체에 HTTP 헤더 형태로 이식해 기존 JwtAuthGuard/passport
 * 경로(req.headers.authorization)를 그대로 태운다 — 가드 이원화 방지.
 */
export interface GraphqlContextArgs {
  req?: Request;
  res?: Response;
  extra?: { request?: IncomingMessage };
  connectionParams?: Record<string, unknown>;
}

export interface GraphqlContext {
  req: Request | IncomingMessage | undefined;
  res?: Response;
}

export function buildGraphqlContext(ctx: GraphqlContextArgs): GraphqlContext {
  const wsRequest = ctx?.extra?.request;
  if (wsRequest) {
    const authorization = ctx.connectionParams?.authorization;
    if (typeof authorization === 'string' && authorization.length > 0) {
      wsRequest.headers = { ...wsRequest.headers, authorization };
    }
    return { req: wsRequest };
  }
  return { req: ctx?.req, res: ctx?.res };
}
