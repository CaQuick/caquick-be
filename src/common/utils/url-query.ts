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
  if (!qs) return {};

  const entries: [string, string | string[]][] = [];
  for (const [key, raw] of Object.entries(qs)) {
    // 쿼리 키는 사용자 입력이라 프로토타입 오염 위험 키는 변환에서 제외한다
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    if (raw === undefined || raw === null) continue;

    if (Array.isArray(raw)) {
      entries.push([
        key,
        raw.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))),
      ]);
    } else if (typeof raw === 'string') {
      entries.push([key, raw]);
    } else {
      entries.push([key, JSON.stringify(raw)]);
    }
  }
  // 할당식 속성 쓰기(out[key]=...) 대신 Object.fromEntries를 쓴다 —
  // define-property 의미라 __proto__류 키로도 프로토타입을 오염시킬 수 없고,
  // CodeQL js/remote-property-injection이 키 블록리스트를 sanitizer로
  // 인식하지 않는 문제(main 재분석에서 확인)도 소스 제거로 해소된다.
  return Object.fromEntries(entries);
}
