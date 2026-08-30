/**
 * 검색어 정규화·단어 분리(DI-free 순수 함수).
 *
 * 검색 기록(SearchHistory/SearchEvent)·인기 검색어 집계·상품/매장 검색이 동일 규칙을
 * 공유해야 "같은 검색어"가 한 키로 모인다 — 정책 확정(검색 화면 문답):
 * trim → 연속 공백 1개로 축약. 최소 길이 제한 없음(1글자 허용), 최대 200자
 * (SearchHistory/SearchEvent.keyword 컬럼 길이). 대소문자는 MySQL collation(ci)에 맡긴다.
 */

/** 정규화된 검색어 최대 길이(keyword 컬럼 VarChar(200)). */
export const SEARCH_KEYWORD_MAX_LENGTH = 200;

export type SearchKeywordInvalidReason = 'EMPTY' | 'TOO_LONG';

export type NormalizeSearchKeywordResult =
  | { ok: true; keyword: string }
  | { ok: false; reason: SearchKeywordInvalidReason };

/** 앞뒤 공백 제거 + 연속 공백(탭·개행 포함) 1개로 축약. 빈 문자열/길이 초과는 실패로 알린다. */
export function normalizeSearchKeyword(
  raw: string,
): NormalizeSearchKeywordResult {
  const keyword = raw.trim().replace(/\s+/g, ' ');
  if (keyword.length === 0) return { ok: false, reason: 'EMPTY' };
  if (keyword.length > SEARCH_KEYWORD_MAX_LENGTH) {
    return { ok: false, reason: 'TOO_LONG' };
  }
  return { ok: true, keyword };
}

/**
 * 정규화된 검색어를 공백 기준 단어로 나눈다(중복 단어 제거).
 * 상품/매장 검색은 각 단어를 AND로 결합한다 — '딸기 케이크'가 '딸기 생크림 케이크'에 매칭.
 */
export function splitSearchWords(normalizedKeyword: string): string[] {
  return [...new Set(normalizedKeyword.split(' ').filter((w) => w !== ''))];
}
