import type { Request } from 'express';
import useragent from 'useragent';

/**
 * User-Agent 헤더 raw 값을 512 자 한도로 자른다.
 * 없으면 undefined (DB nullable persistence 용).
 */
export function tryUserAgent(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : undefined;
}

/**
 * Client IP 를 추출한다 (X-Forwarded-For → X-Real-IP → req.ip → socket.remoteAddress 순).
 * 추출 실패 시 undefined (DB nullable persistence 용).
 *
 * 운영 환경에서 정확한 client IP 를 얻으려면 main.ts 의 trust proxy 설정 필요
 * (Express 가 X-Forwarded-For 를 신뢰해서 req.ip 에 반영).
 */
export function tryClientIp(req: Request): string | undefined {
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
  return typeof ip === 'string' && ip.length > 0 ? ip : undefined;
}

/**
 * API 버전 헤더 추출
 */
export function apiVersionOf(req: Request): string | undefined {
  const v = req.headers['api-version'];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * 클라이언트 IP 추출 (로깅용 — 추출 실패 시 'Unknown IP' fallback)
 */
export function clientIpOf(req: Request): string {
  return tryClientIp(req) ?? 'Unknown IP';
}

/**
 * User-Agent 문자열 정규화 (로깅용 — useragent 라이브러리로 파싱).
 * raw 값은 tryUserAgent 사용 (DB persistence 용).
 */
export function userAgentOf(req: Request): string {
  const raw =
    typeof req.headers['user-agent'] === 'string'
      ? req.headers['user-agent']
      : undefined;
  const parsed = useragent.parse(raw);
  return parsed ? parsed.toString() : 'Unknown User Agent';
}
