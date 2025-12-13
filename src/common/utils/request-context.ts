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
 * 요청 헤더에서 단일 문자열 헤더 값을 안전하게 꺼낸다.
 */
function readSingleHeader(
  req: Request,
  headerName: string,
): string | undefined {
  const raw = req.headers[headerName];
  if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  if (Array.isArray(raw)) {
    const first = raw.find((v) => typeof v === 'string' && v.trim().length > 0);
    return typeof first === 'string' ? first.trim() : undefined;
  }
  return undefined;
}

/**
 * requestId/startTime을 보장하고 헤더에 반영한다.
 * - 들어온 x-request-id가 있으면 그 값을 우선 사용한다.
 */
export function ensureRequestTracking(
  req: Request,
  res?: Response,
): RequestTracking {
  if (!req.requestId) {
    const incoming = readSingleHeader(req, REQUEST_ID_HEADER);
    req.requestId = incoming ?? uuid();
  }

  res?.setHeader(REQUEST_ID_HEADER, req.requestId);

  if (typeof req.startTime !== 'number') {
    req.startTime = Date.now();
  }

  return { requestId: req.requestId, startTime: req.startTime };
}

/**
 * 시작 시간 기준 처리 시간을 계산한다.
 */
export function calculateDuration(startTime?: number): number | undefined {
  if (typeof startTime !== 'number') return undefined;
  return Date.now() - startTime;
}

/**
 * 응답 헤더에 처리 시간을 기록한다.
 */
export function setResponseTimeHeader(
  res: Response | undefined,
  duration?: number,
): void {
  if (!res || typeof duration !== 'number') return;
  res.setHeader(RESPONSE_TIME_HEADER, String(duration));
}

/**
 * HTTP 요청 메타데이터를 구성한다.
 */
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

/**
 * GraphQL 요청 메타데이터를 구성한다.
 */
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

  if (typeof candidate === 'number') return candidate;

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) return null;

    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  return null;
}
