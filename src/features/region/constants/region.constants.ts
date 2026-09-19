export const DEFAULT_REGION_SEARCH_LIMIT = 20;

// ── 지역 마스터 ──

export const MAX_REGION_NAME_LENGTH = 80;
export const MAX_REGION_SLUG_LENGTH = 120;
/** 정책: 소문자·숫자·`-`만(기존 시드 slug 'sgg-11440' 형식과 호환). */
export const REGION_SLUG_PATTERN = /^[a-z0-9-]+$/;
