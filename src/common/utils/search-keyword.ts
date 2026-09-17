import { DomainException } from '@/common/errors/error-catalog';

/**
 * 검색 기록·인기 검색어 집계·상품/매장 검색이 동일 규칙을 공유해야 "같은 검색어"가 한 키로 모인다:
 * trim → 연속 공백 1개로 축약, 최소 길이 없음, 최대 200자(keyword 컬럼 길이). 대소문자는 MySQL collation(ci)에 맡긴다.
 */

export const SEARCH_KEYWORD_MAX_LENGTH = 200;

export type SearchKeywordInvalidReason = 'EMPTY' | 'TOO_LONG';

export type NormalizeSearchKeywordResult =
  | { ok: true; keyword: string }
  | { ok: false; reason: SearchKeywordInvalidReason };

export function normalizeSearchKeyword(
  raw: string,
): NormalizeSearchKeywordResult {
  const keyword = raw.trim().replace(/\s+/g, ' ');
  if (keyword.length === 0) return { ok: false, reason: 'EMPTY' };
  // MySQL VarChar(200)은 문자(코드 포인트) 수 기준 — UTF-16 단위(.length)로 세면
  // 서로게이트 쌍(이모지 등)이 2로 계산돼 저장 가능한 검색어를 거절한다
  if ([...keyword].length > SEARCH_KEYWORD_MAX_LENGTH) {
    return { ok: false, reason: 'TOO_LONG' };
  }
  return { ok: true, keyword };
}

/** 상품/매장 검색은 각 단어를 AND로 결합한다 — '딸기 케이크'가 '딸기 생크림 케이크'에 매칭. */
export function splitSearchWords(normalizedKeyword: string): string[] {
  return [...new Set(normalizedKeyword.split(' ').filter((w) => w !== ''))];
}

export interface ParsedSearchKeyword {
  keyword: string;
  words: string[];
}

export function parseSearchKeyword(raw: string): ParsedSearchKeyword {
  const result = normalizeSearchKeyword(raw);
  if (!result.ok) {
    throw new DomainException(
      result.reason === 'EMPTY' ? 'KEYWORD_EMPTY' : 'KEYWORD_TOO_LONG',
    );
  }
  return { keyword: result.keyword, words: splitSearchWords(result.keyword) };
}
