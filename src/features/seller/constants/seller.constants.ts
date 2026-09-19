// ── 텍스트 필드 최대 길이 ──

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
export const MAX_OPTION_GROUP_DESCRIPTION_LENGTH = 1000;
export const MAX_OPTION_ITEM_TITLE_LENGTH = 120;
export const MAX_OPTION_ITEM_DESCRIPTION_LENGTH = 500;

// ── 커스텀 템플릿 ──

export const MAX_TOKEN_KEY_LENGTH = 60;
export const MAX_TOKEN_DEFAULT_TEXT_LENGTH = 200;
export const DEFAULT_TOKEN_MAX_LENGTH = 30;

// ── 대화 ──

export const MAX_CONVERSATION_BODY_TEXT_LENGTH = 2000;
// store.greeting_message VARCHAR(500)과 동일 상한
export const MAX_CONVERSATION_BODY_HTML_LENGTH = 100000;

// ── 감사 로그 ──

export const SELLER_AUDIT_TARGET_TYPES = [
  'STORE',
  'PRODUCT',
  'ORDER',
  'CONVERSATION',
  'CHANGE_PASSWORD',
] as const;
export type SellerAuditTargetType = (typeof SELLER_AUDIT_TARGET_TYPES)[number];
