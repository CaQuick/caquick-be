import type { ParsedQs } from 'qs';

export type QueryParams = Record<
  string,
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | null
  | undefined
>;

/**
 * QueryParams 객체를 쿼리 문자열로 변환
 */
export function buildQueryString(queryParams: QueryParams): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(queryParams)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      parts.push(
        `${encodeURIComponent(key)}=${value.map(String).map(encodeURIComponent).join(',')}`,
      );
    } else {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    }
  }
  return parts.join('&');
}

/**
 * ParsedQs → 안전한 QueryParams로 변환
 */
export function toQueryParams(qs: ParsedQs | undefined): QueryParams {
  const out: QueryParams = {};
  if (!qs) return out;

  for (const [key, raw] of Object.entries(qs)) {
    // 쿼리 키는 사용자 입력이라 프로토타입 오염 위험 키를 속성으로 쓰지 않는다
    // (CodeQL js/remote-property-injection). Set 대신 직접 비교를 쓰는 이유:
    // CodeQL이 sanitizer로 인식하는 패턴이 명시적 키 비교이기 때문.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    if (raw === undefined || raw === null) continue;

    if (Array.isArray(raw)) {
      out[key] = raw.map((v) =>
        typeof v === 'string' ? v : JSON.stringify(v),
      );
    } else if (typeof raw === 'string') {
      out[key] = raw;
    } else {
      out[key] = JSON.stringify(raw);
    }
  }
  return out;
}
