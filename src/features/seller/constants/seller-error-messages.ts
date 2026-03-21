import { MAX_PRODUCT_IMAGES } from './seller.constants';

// ── 공통 ──

export const ACCOUNT_NOT_FOUND = 'Account not found.';
export const SELLER_ONLY = 'Only SELLER account is allowed.';
export const STORE_NOT_FOUND = 'Store not found.';
export const DUPLICATE_IDS = 'Duplicate ids are not allowed.';
export const INVALID_TIME_VALUE = 'Invalid time value.';
export const INVALID_DECIMAL_VALUE = 'Invalid decimal value.';
export const INVALID_CURRENCY_FORMAT = 'Invalid currency format.';

// ── 상품 ──

export const PRODUCT_NOT_FOUND = 'Product not found.';
export const SALE_PRICE_EXCEEDS_REGULAR =
  'salePrice must be less than or equal to regularPrice.';
export const IMAGE_LIMIT_EXCEEDED = `Product images can be up to ${MAX_PRODUCT_IMAGES}.`;
export const IMAGE_MIN_REQUIRED = 'At least one product image is required.';
export const PRODUCT_IMAGE_NOT_FOUND = 'Product image not found.';

// ── 옵션 ──

export const OPTION_GROUP_NOT_FOUND = 'Option group not found.';
export const OPTION_ITEM_NOT_FOUND = 'Option item not found.';
export const INVALID_SELECT_RANGE = 'Invalid minSelect/maxSelect.';
export const MAX_SELECT_BELOW_MIN = 'maxSelect must be >= minSelect.';

// ── 커스텀 템플릿 ──

export const CUSTOM_TEMPLATE_NOT_FOUND = 'Custom template not found.';
export const CUSTOM_TEXT_TOKEN_NOT_FOUND = 'Custom text token not found.';

// ── 매장 ──

export const INVALID_DAY_OF_WEEK = 'dayOfWeek must be 0~6.';
export const OPEN_CLOSE_TIME_REQUIRED = 'openTime and closeTime are required.';
export const CLOSE_BEFORE_OPEN = 'closeTime must be after openTime.';
export const SPECIAL_CLOSURE_NOT_FOUND = 'Special closure not found.';
export const DAILY_CAPACITY_NOT_FOUND = 'Daily capacity not found.';

// ── 배너 ──

export const BANNER_NOT_FOUND = 'Banner not found.';
export const LINK_URL_REQUIRED = 'linkUrl is required when linkType is URL.';
export const LINK_PRODUCT_REQUIRED =
  'linkProductId is required when linkType is PRODUCT.';
export const LINK_PRODUCT_MISMATCH = 'Cannot link product outside your store.';
export const LINK_STORE_REQUIRED =
  'linkStoreId is required when linkType is STORE.';
export const LINK_STORE_MISMATCH = 'Cannot link another store.';
export const LINK_CATEGORY_REQUIRED =
  'linkCategoryId is required when linkType is CATEGORY.';
export const INVALID_BANNER_PLACEMENT = 'Invalid banner placement.';
export const INVALID_BANNER_LINK_TYPE = 'Invalid banner link type.';

// ── 콘텐츠 ──

export const FAQ_TOPIC_NOT_FOUND = 'FAQ topic not found.';
export const INVALID_AUDIT_TARGET_TYPE = 'Invalid audit target type.';

// ── 대화 ──

export const CONVERSATION_NOT_FOUND = 'Conversation not found.';
export const BODY_TEXT_REQUIRED = 'bodyText is required for TEXT format.';
export const BODY_HTML_REQUIRED = 'bodyHtml is required for HTML format.';
export const INVALID_BODY_FORMAT = 'Invalid body format.';

// ── 주문 ──

export const ORDER_NOT_FOUND = 'Order not found.';
export const CANCELLATION_NOTE_REQUIRED = 'Cancellation note is required.';

// ── 동적 에러 메시지 헬퍼 ──

export function fieldRangeError(
  field: string,
  min: number,
  max: number,
): string {
  return `${field} must be ${min}~${max}.`;
}

export function idsMismatchError(field: string): string {
  return `${field} length mismatch.`;
}

export function invalidIdsError(field: string): string {
  return `Invalid ${field}.`;
}
