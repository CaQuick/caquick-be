// 판매자 상품·옵션·커스텀 템플릿 입력 한계. 서비스가 같은 값을 쓴다.

export const MAX_URL_LENGTH = 2048;

// ── 상품 ──

export const MAX_PRODUCT_NAME_LENGTH = 200;
export const MAX_PRODUCT_DESCRIPTION_LENGTH = 50000;
export const MAX_PRODUCT_PURCHASE_NOTICE_LENGTH = 50000;
export const DEFAULT_PREPARATION_TIME_MINUTES = 180;
export const MIN_PRODUCT_PRICE = 1;
export const MIN_SALE_PRICE = 0;
export const MAX_PRODUCT_PRICE = 1_000_000_000;
export const MAX_PRODUCT_IMAGES = 6;
export const MIN_PRODUCT_IMAGES = 1;

// ── 옵션 ──

export const MAX_OPTION_GROUP_NAME_LENGTH = 120;
export const MAX_OPTION_GROUP_DESCRIPTION_LENGTH = 1000;
export const MAX_OPTION_ITEM_TITLE_LENGTH = 120;
export const MAX_OPTION_ITEM_DESCRIPTION_LENGTH = 500;
export const MAX_THREE_D_KEY_LENGTH = 40;

// ── 커스텀 템플릿 ──

export const TOKEN_KEY_PATTERN = /^[a-z0-9]{1,60}$/;
export const MAX_TOKEN_LABEL_LENGTH = 30;
export const MAX_TOKEN_DEFAULT_TEXT_LENGTH = 200;
export const DEFAULT_TOKEN_MAX_LENGTH = 20;
export const TOKEN_MAX_LENGTH_RANGE = { min: 1, max: 50 } as const;
export const DEFAULT_TEXT_COLOR = '#000000';
/** 바탕 이미지 한 변을 이 값으로 본 정수 비율이 문구 자리 좌표다(원점 왼쪽 위). */
export const CUSTOM_AREA_SCALE = 10_000;
/** 바탕 이미지 가로·세로 차이 허용치(px). 크롭·축소 반올림 오차만 받는다. */
export const BASE_IMAGE_SQUARE_TOLERANCE_PX = 1;

// ── 태그 검색 ──

export const DEFAULT_TAG_SUGGESTIONS = 10;
export const MAX_TAG_SUGGESTIONS = 20;

// ── 태그 연결 ──

export const MAX_TAGS_PER_PRODUCT = 20;
