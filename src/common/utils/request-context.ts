import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';
import type { GraphQLResolveInfo } from 'graphql';

import {
  apiVersionOf,
  clientIpOf,
  userAgentOf,
} from '@/common/utils/http-meta';
import {
  buildQueryString,
  type QueryParams,
  toQueryParams,
} from '@/common/utils/url-query';

export const REQUEST_ID_HEADER = 'x-request-id';
export const RESPONSE_TIME_HEADER = 'x-response-time-ms';
/** 클라이언트가 보낸 x-request-id를 그대로 로그·응답 헤더에 싣기 전 형식을 제한한다 — 길이·문자 무제한이면 로그 주입·헤더 부풀림. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
/** 로그에 남기지 않는 쿼리 키 — OIDC 콜백의 code·state, 토큰류. 값만 가린다(키는 남겨 흐름은 보이게). */
export const REDACTED_QUERY_KEYS: ReadonlySet<string> = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'password',
]);
export const REDACTED_VALUE = '[redacted]';

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

export function ensureRequestTracking(
  req: Request,
  res?: Response,
): RequestTracking {
  if (!req.requestId) {
    const incoming = readSingleHeader(req, REQUEST_ID_HEADER);
    req.requestId =
      incoming !== undefined && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();
  }

  if (res && !res.headersSent) {
    res.setHeader(REQUEST_ID_HEADER, req.requestId);
  }

  if (typeof req.startTime !== 'number') {
    req.startTime = Date.now();
  }

  return { requestId: req.requestId, startTime: req.startTime };
}

function redactQuery(params: QueryParams): QueryParams {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      REDACTED_QUERY_KEYS.has(key.toLowerCase()) && value !== undefined
        ? REDACTED_VALUE
        : value,
    ]),
  );
}

export function calculateDuration(startTime?: number): number | undefined {
  if (typeof startTime !== 'number') return undefined;
  return Date.now() - startTime;
}

export function setResponseTimeHeader(
  res: Response | undefined,
  duration?: number,
): void {
  if (!res || typeof duration !== 'number' || res.headersSent) return;
  res.setHeader(RESPONSE_TIME_HEADER, String(duration));
}

export function buildHttpRequestMeta(
  req: Request,
  options?: { defaultVersion?: string },
): HttpRequestMeta {
  const path = req.originalUrl?.split('?')[0] ?? req.path ?? '';
  const query = buildQueryString(redactQuery(toQueryParams(req.query)));
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
