// ── 텍스트 필드 최대 길이 ──

/** URL 필드 공통 최대 길이 */
export const MAX_URL_LENGTH = 2048;

// ── 상품 ──

export const MAX_PRODUCT_NAME_LENGTH = 200;
export const MAX_PRODUCT_DESCRIPTION_LENGTH = 50000;
export const MAX_PRODUCT_PURCHASE_NOTICE_LENGTH = 50000;
export const DEFAULT_PREPARATION_TIME_MINUTES = 180;
export const MIN_PRODUCT_PRICE = 1;
export const MIN_SALE_PRICE = 0;
export const MAX_PRODUCT_PRICE = 1_000_000_000;
export const MAX_PRODUCT_IMAGES = 5;
export const MIN_PRODUCT_IMAGES = 1;

// ── 옵션 ──

export const MAX_OPTION_GROUP_NAME_LENGTH = 120;
export const MAX_OPTION_ITEM_TITLE_LENGTH = 120;
export const MAX_OPTION_ITEM_DESCRIPTION_LENGTH = 500;

// ── 커스텀 템플릿 ──

export const MAX_TOKEN_KEY_LENGTH = 60;
export const MAX_TOKEN_DEFAULT_TEXT_LENGTH = 200;
export const DEFAULT_TOKEN_MAX_LENGTH = 30;

// ── 매장 ──

export const MAX_STORE_NAME_LENGTH = 200;
export const MAX_STORE_PHONE_LENGTH = 30;
export const MAX_ADDRESS_FULL_LENGTH = 500;
export const MAX_ADDRESS_CITY_LENGTH = 50;
export const MAX_ADDRESS_DISTRICT_LENGTH = 80;
export const MAX_ADDRESS_NEIGHBORHOOD_LENGTH = 80;
export const MAX_BUSINESS_HOURS_TEXT_LENGTH = 500;
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

// ── 콘텐츠 (FAQ / 배너) ──

export const MAX_FAQ_TITLE_LENGTH = 120;
export const MAX_FAQ_ANSWER_HTML_LENGTH = 100000;
export const MAX_BANNER_TITLE_LENGTH = 200;

// ── 대화 ──

export const MAX_CONVERSATION_BODY_TEXT_LENGTH = 2000;
export const MAX_CONVERSATION_BODY_HTML_LENGTH = 100000;
