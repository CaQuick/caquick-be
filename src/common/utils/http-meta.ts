import { isIP } from 'node:net';

import type { Request } from 'express';
import useragent from 'useragent';

export function tryUserAgent(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : undefined;
}

/** req.ip만 신뢰한다 — raw X-Forwarded-For/X-Real-IP는 클라이언트가 위조할 수 있어(IP spoofing) hop 수 적용을 Express trust proxy(main.ts TRUST_PROXY_HOPS)에 위임한다. */
export function tryClientIp(req: Request): string | undefined {
  const ip = req.ip ?? req.socket?.remoteAddress;
  return typeof ip === 'string' && ip.length > 0 ? ip : undefined;
}

export function apiVersionOf(req: Request): string | undefined {
  const v = req.headers['api-version'];
  return Array.isArray(v) ? v[0] : v;
}

export function clientIpOf(req: Request): string {
  return tryClientIp(req) ?? 'Unknown IP';
}

export function userAgentOf(req: Request): string {
  const raw =
    typeof req.headers['user-agent'] === 'string'
      ? req.headers['user-agent']
      : undefined;
  const parsed = useragent.parse(raw);
  return parsed ? parsed.toString() : 'Unknown User Agent';
}

const MAX_PERSISTED_USER_AGENT_LENGTH = 512;

/**
 * 저장용 ip 정규화(감사 로그·outbox 공용). trust proxy 환경에서 req.ip는 프록시가 넘긴 값이라 malformed·overlong 값이
 * 그대로 오면 VarChar(64) 초과로 insert가 실패할 수 있다 — 유효한 IPv4/IPv6가 아니면 null.
 */
export function normalizeIpForPersistence(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return isIP(value) !== 0 ? value : null;
}

export function normalizeUserAgentForPersistence(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return value.slice(0, MAX_PERSISTED_USER_AGENT_LENGTH);
}
