import type { Request, Response } from 'express';
import type { GraphQLResolveInfo } from 'graphql';
import { v4 as uuid } from 'uuid';

import {
  buildQueryString,
  toQueryParams,
} from 'src/common/helpers/url-query.helper';
import {
  apiVersionOf,
  clientIpOf,
  userAgentOf,
} from 'src/common/utils/http-meta';

export const REQUEST_ID_HEADER = 'x-request-id';
export const RESPONSE_TIME_HEADER = 'x-response-time-ms';

export interface RequestTracking {
  requestId: string;
  startTime: number;
}

export interface HttpRequestMeta {
  method: string;
  path: string;
  query: string;
  version?: string;
  clientIp: string;
  agent: string;
}

export interface GraphqlRequestMeta {
  operationName?: string;
  fieldName: string;
  parentType?: string;
  path: string;
  clientIp: string;
  agent: string;
}

/**
 * requestId/startTime을 보장하고 헤더에 반영한다.
 */
export function ensureRequestTracking(
  req: Request,
  res?: Response,
): RequestTracking {
  if (!req.requestId) {
    req.requestId = uuid();
    res?.setHeader(REQUEST_ID_HEADER, req.requestId);
  }

  if (typeof req.startTime !== 'number') {
    req.startTime = Date.now();
  }

  return { requestId: req.requestId, startTime: req.startTime };
}

export function calculateDuration(startTime?: number): number | undefined {
  if (typeof startTime !== 'number') return undefined;
  return Date.now() - startTime;
}

export function setResponseTimeHeader(
  res: Response | undefined,
  duration?: number,
): void {
  if (!res || typeof duration !== 'number') return;
  res.setHeader(RESPONSE_TIME_HEADER, String(duration));
}

export function buildHttpRequestMeta(
  req: Request,
  options?: { defaultVersion?: string },
): HttpRequestMeta {
  const path = req.originalUrl?.split('?')[0] ?? req.path ?? '';
  const query = buildQueryString(toQueryParams(req.query));
  const version = apiVersionOf(req) ?? options?.defaultVersion;

  return {
    method: req.method,
    path,
    query,
    version,
    clientIp: clientIpOf(req),
    agent: userAgentOf(req),
  };
}

export function buildGraphqlRequestMeta(
  info: GraphQLResolveInfo,
  req: Request,
): GraphqlRequestMeta {
  const pathKey =
    typeof info.path?.key === 'string' || typeof info.path?.key === 'number'
      ? String(info.path.key)
      : info.fieldName;

  return {
    operationName: info.operation?.name?.value,
    fieldName: info.fieldName,
    parentType: info.parentType?.toString(),
    path: pathKey,
    clientIp: clientIpOf(req),
    agent: userAgentOf(req),
  };
}

/**
 * Express Request에 바인딩된 사용자 정보를 기반으로 userId를 추출한다.
 */
export function resolveUserId(req: Request): number | null {
  const user = (req as { user?: { id?: unknown; sub?: unknown } }).user;
  const candidate = user?.id ?? user?.sub;
  return typeof candidate === 'number' ? candidate : null;
}
