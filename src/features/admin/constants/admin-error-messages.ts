// ── 공통 ──

export const ACCOUNT_NOT_FOUND = 'Account not found.';
export const ADMIN_ONLY = 'Only ADMIN account is allowed.';
export const ACCOUNT_NOT_ACTIVE = 'Account is not active.';
export const INVALID_CURSOR = 'Invalid cursor.';

// ── 계정 ──

export const USERNAME_TAKEN = 'Username is already taken.';
export const SELLER_NOT_FOUND = 'Seller account not found.';

// ── 매장 ──

export const REGION_NOT_SELECTABLE =
  'regionId must be an active level-2 region.';
export const INVALID_DECIMAL_VALUE = 'Invalid decimal value.';

// ── 배너 ──

export const BANNER_NOT_FOUND = 'Banner not found.';
export const LINK_URL_REQUIRED = 'linkUrl is required for URL link type.';
export const LINK_PRODUCT_REQUIRED =
  'linkProductId is required for PRODUCT link type.';
export const LINK_STORE_REQUIRED =
  'linkStoreId is required for STORE link type.';
export const LINK_CATEGORY_REQUIRED =
  'linkCategoryId is required for CATEGORY link type.';
export const LINK_FIELDS_MISMATCH =
  'Link fields do not match the intended linkType.';
export const LINK_PRODUCT_NOT_VISIBLE =
  'Link product not found or not visible (inactive, deleted, or store hidden).';
export const LINK_STORE_NOT_VISIBLE =
  'Link store not found or not visible (inactive or deleted).';
export const LINK_CATEGORY_NOT_VISIBLE =
  'Link category not found or not visible (inactive or deleted).';
export const CATEGORY_PLACEMENT_REQUIRES_CATEGORY_LINK =
  'CATEGORY placement requires linkType CATEGORY.';
export const CATEGORY_PLACEMENT_REQUIRES_EVENT_CATEGORY =
  'CATEGORY placement requires an EVENT category link.';
export const INVALID_EXPOSURE_WINDOW = 'startsAt must be earlier than endsAt.';
