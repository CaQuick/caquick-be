// 판매자 매장 설정·FAQ 입력 한계. DTO·서비스가 같은 값을 쓴다.

// ── 매장 ──
export const MAX_SPECIAL_CLOSURE_REASON_LENGTH = 200;

export const MIN_DAY_OF_WEEK = 0;
export const MAX_DAY_OF_WEEK = 6;

export const MIN_PICKUP_SLOT_INTERVAL_MINUTES = 5;
export const MAX_PICKUP_SLOT_INTERVAL_MINUTES = 180;
export const MIN_LEAD_TIME_MINUTES = 0;
export const MAX_LEAD_TIME_MINUTES = 7 * 24 * 60; // 7일
export const MIN_DAYS_AHEAD = 1;
export const MAX_DAYS_AHEAD = 365;
export const MIN_DAILY_CAPACITY = 1;
export const MAX_DAILY_CAPACITY = 5000;

// ── 콘텐츠 (FAQ) ──

export const MAX_FAQ_TITLE_LENGTH = 120;
export const MAX_FAQ_ANSWER_HTML_LENGTH = 100000;
