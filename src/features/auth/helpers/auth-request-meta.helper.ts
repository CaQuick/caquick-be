import type { Request } from 'express';

/**
 * Request 에서 user-agent 를 추출한다 (audit/refresh session 메타용).
 *
 * 길이 512 자에서 자른다.
 */
export function getUserAgent(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : undefined;
}

/**
 * Request 에서 IP 를 추출한다.
 */
export function getIp(req: Request): string | undefined {
  return typeof req.ip === 'string' ? req.ip : undefined;
}
