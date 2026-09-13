// ── 공통 ──

export const ACCOUNT_NOT_FOUND = 'Account not found.';
export const ADMIN_ONLY = 'Only ADMIN account is allowed.';
export const ACCOUNT_NOT_ACTIVE = 'Account is not active.';
export const INVALID_CURSOR = 'Invalid cursor.';

// ── 계정 ──

export const USERNAME_TAKEN = 'Username is already taken.';
export const SELLER_NOT_FOUND = 'Seller account not found.';
export const USER_NOT_FOUND = 'User account not found.';
export const CANNOT_CHANGE_OWN_STATUS =
  'Cannot change your own account status.';
export const CANNOT_CHANGE_ADMIN_STATUS =
  'Cannot change the status of an ADMIN account.';
export const ONLY_ACTIVE_CAN_BE_SUSPENDED =
  'Only an ACTIVE account can be suspended.';
export const ONLY_SUSPENDED_CAN_BE_REINSTATED =
  'Only a SUSPENDED account can be reinstated.';

// ── 매장 ──

export const STORE_NOT_FOUND = 'Store not found.';
export const PRODUCT_NOT_FOUND = 'Product not found.';

// ── 카테고리·태그 ──

export const CATEGORY_NOT_FOUND = 'Category not found.';
export const CATEGORY_NAME_TAKEN =
  'Category name is already used in this type.';
export const TAG_NOT_FOUND = 'Tag not found.';
export const TAG_NAME_TAKEN = 'Tag name is already used.';

// ── 리뷰 모더레이션 ──

export const REVIEW_REPORT_NOT_FOUND = 'Review report not found.';
export const REVIEW_REPORT_ALREADY_RESOLVED =
  'Review report is already resolved.';
export const REVIEW_NOT_FOUND = 'Review not found.';
export const REVIEW_COMMENT_NOT_FOUND = 'Review comment not found.';
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
