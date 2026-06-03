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
 * Client IP 를 추출한다.
 *
 * Express 의 `trust proxy` 설정(main.ts, `TRUST_PROXY_HOPS`)으로 계산된 `req.ip` 를
 * 단일 진실 소스로 사용한다. trust proxy 가 설정되면 Express 가 X-Forwarded-For 를
 * hop 수만큼 신뢰해 실제 client IP 를 `req.ip` 에 반영하고, 미설정 시 socket 주소를 쓴다.
 *
 * raw `X-Forwarded-For` / `X-Real-IP` 헤더를 **직접 신뢰하지 않는다** — 클라이언트가
 * 임의로 위조할 수 있어 trust proxy 검증을 우회하기 때문(IP spoofing). hop 수 적용은
 * 전적으로 Express 에 위임한다.
 *
 * 추출 실패 시 undefined (DB nullable persistence 용).
 */
export function tryClientIp(req: Request): string | undefined {
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
