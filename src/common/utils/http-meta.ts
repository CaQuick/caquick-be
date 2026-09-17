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
