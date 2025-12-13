import type { Request } from 'express';
import useragent from 'useragent';

/**
 * API 버전 헤더 추출
 */
export function apiVersionOf(req: Request): string | undefined {
  const v = req.headers['api-version'];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * 클라이언트 IP 추출(X-Forwarded-For 우선)
 */
export function clientIpOf(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) {
    const forwardedIp = forwardedFor.split(',').map((ip) => ip.trim())[0];
    if (forwardedIp) return forwardedIp;
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim().length > 0) {
    return realIp;
  }

  const ip = req.ip ?? req.socket?.remoteAddress;
  return typeof ip === 'string' && ip.length > 0 ? ip : 'Unknown IP';
}

/**
 * User-Agent 문자열 정규화
 */
export function userAgentOf(req: Request): string {
  const raw =
    typeof req.headers['user-agent'] === 'string'
      ? req.headers['user-agent']
      : undefined;
  const parsed = useragent.parse(raw);
  return parsed ? parsed.toString() : 'Unknown User Agent';
}
