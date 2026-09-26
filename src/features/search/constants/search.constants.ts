export const DEFAULT_POPULAR_KEYWORDS_LIMIT = 10;

/** 노출은 10건이지만 직전 11~20위에서 올라온 키워드를 NEW가 아니라 UP으로 판정하기 위해 20건을 저장한다. */
export const KEYWORD_RANK_SNAPSHOT_SIZE = 20;

export const KEYWORD_RANK_WINDOW_HOURS = 24;
