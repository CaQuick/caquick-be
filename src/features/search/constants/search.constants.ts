/** 인기 검색어 기본 노출 개수(figma 검색 진입 시안 TOP10). */
export const DEFAULT_POPULAR_KEYWORDS_LIMIT = 10;

/**
 * 스냅샷당 저장 순위 수. 노출은 10건이지만 직전 11~20위에서 올라온 키워드를
 * NEW가 아니라 UP으로 판정하기 위해 20건을 저장한다(사용자 확정).
 */
export const KEYWORD_RANK_SNAPSHOT_SIZE = 20;

/** popularSearchKeywords limit 상한(= 스냅샷 저장 크기). */
export const MAX_POPULAR_KEYWORDS_LIMIT = KEYWORD_RANK_SNAPSHOT_SIZE;

/** 스냅샷 집계 윈도우(시간). 직전 24시간 SearchEvent를 keyword별로 센다. */
export const KEYWORD_RANK_WINDOW_HOURS = 24;

export const HOUR_MS = 60 * 60 * 1000;
