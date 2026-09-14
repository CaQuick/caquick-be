import { HttpStatus } from '@nestjs/common';

/**
 * 도메인 에러 카탈로그 — 코드와 메시지의 단일 정본.
 *
 * 왜 한곳에 모으는가:
 * 1. 같은 문장이 feature마다 복제돼 있었다("상품을 찾을 수 없습니다."만 3벌).
 *    문구를 고치려면 여러 파일을 찾아야 했고, 실제로 표현이 조금씩 갈라져 있었다
 *    ("매장을 찾을 수 없습니다." vs "존재하지 않는 매장입니다.").
 * 2. 클라이언트가 분기할 안정적인 식별자가 없었다. 메시지 문자열로 분기하면
 *    문구를 다듬는 순간 깨진다. 이제 GraphQL `extensions.errorCode`로 코드가 나간다.
 * 3. 서비스가 나뉘어도 코드 계약은 공유할 수 있다 — 문자열 공유보다 이식이 쉽다.
 *
 * 메시지는 한국어로 통일한다(사용자 확정). 상태 코드는 여기서 정하고,
 * `domainError()`가 대응하는 NestJS 예외 클래스를 고른다.
 */
export interface ErrorDefinition {
  status: HttpStatus;
  message: string;
}

const NOT_FOUND = HttpStatus.NOT_FOUND;
const BAD_REQUEST = HttpStatus.BAD_REQUEST;
const CONFLICT = HttpStatus.CONFLICT;
const FORBIDDEN = HttpStatus.FORBIDDEN;
const UNAUTHORIZED = HttpStatus.UNAUTHORIZED;
const INTERNAL = HttpStatus.INTERNAL_SERVER_ERROR;

export const ERROR_CATALOG = {
  // ── 조회 실패 (여러 feature 공용) ──
  PRODUCT_NOT_FOUND: { status: NOT_FOUND, message: '상품을 찾을 수 없습니다.' },
  STORE_NOT_FOUND: { status: NOT_FOUND, message: '매장을 찾을 수 없습니다.' },
  ORDER_NOT_FOUND: { status: NOT_FOUND, message: '주문을 찾을 수 없습니다.' },
  ORDER_ITEM_NOT_FOUND: {
    status: NOT_FOUND,
    message: '주문 아이템을 찾을 수 없습니다.',
  },
  REVIEW_NOT_FOUND: { status: NOT_FOUND, message: '리뷰를 찾을 수 없습니다.' },
  REVIEW_COMMENT_NOT_FOUND: {
    status: NOT_FOUND,
    message: '댓글을 찾을 수 없습니다.',
  },
  NOTIFICATION_NOT_FOUND: {
    status: NOT_FOUND,
    message: '알림을 찾을 수 없습니다.',
  },
  REGION_GROUP_NOT_FOUND: {
    status: NOT_FOUND,
    message: '존재하지 않는 1차 지역입니다.',
  },

  // ── 입력 형식 ──
  INVALID_CURSOR: {
    status: BAD_REQUEST,
    message: '커서 형식이 올바르지 않습니다.',
  },
  INVALID_LIKES_CURSOR: {
    status: BAD_REQUEST,
    message: '좋아요순 커서 형식이 올바르지 않습니다.',
  },
  INVALID_YEAR_MONTH: {
    status: BAD_REQUEST,
    message: '유효하지 않은 연월 형식입니다. (YYYY-MM)',
  },
  INVALID_DATE: {
    status: BAD_REQUEST,
    message: '유효하지 않은 날짜 형식입니다. (YYYY-MM-DD)',
  },
  INVALID_DECIMAL_VALUE: {
    status: BAD_REQUEST,
    message: '숫자 형식이 올바르지 않습니다.',
  },
  INVALID_PRICE_RANGE: {
    status: BAD_REQUEST,
    message: '최저가는 최고가보다 클 수 없습니다.',
  },

  // ── 계정·권한 ──
  // 401 — 계정 상태가 유효하지 않아 인증을 다시 세워야 하는 경우.
  // 403(BUYER_NOT_USER)과 구분한다: 그쪽은 인증은 됐으나 자격이 없는 경우다.
  BUYER_ACCOUNT_NOT_ACTIVE: {
    status: UNAUTHORIZED,
    message: '유효한 사용자 계정이 아닙니다.',
  },
  BUYER_NOT_USER: {
    status: FORBIDDEN,
    message: 'USER 계정만 주문할 수 있습니다.',
  },
  STORE_WISHLIST_USER_ONLY: {
    status: FORBIDDEN,
    message: '매장 찜은 일반 사용자만 이용할 수 있습니다.',
  },
  NOT_COMMENT_OWNER: {
    status: FORBIDDEN,
    message: '본인 댓글만 삭제할 수 있습니다.',
  },
  CANNOT_REPORT_OWN_CONTENT: {
    status: BAD_REQUEST,
    message: '본인이 작성한 리뷰·댓글은 신고할 수 없습니다.',
  },

  // ── 주문 생성(체크아웃) ──
  DUPLICATE_OPTION_ITEM: {
    status: BAD_REQUEST,
    message: '중복된 옵션 선택입니다.',
  },
  INVALID_OPTION_ITEM: {
    status: BAD_REQUEST,
    message: '해당 상품의 옵션이 아닙니다.',
  },
  OPTION_GROUP_RULE_VIOLATION: {
    status: BAD_REQUEST,
    message: '옵션 그룹의 선택 규칙을 충족하지 않습니다.',
  },
  OPTION_CUSTOMIZATION_REQUIRED: {
    status: BAD_REQUEST,
    message: '커스텀 정보가 필요한 옵션은 아직 주문할 수 없습니다.',
  },
  PICKUP_NOT_AVAILABLE: {
    status: BAD_REQUEST,
    message: '선택한 픽업 일시는 예약할 수 없습니다.',
  },
  ORDER_AMOUNT_OUT_OF_RANGE: {
    status: BAD_REQUEST,
    message: '주문 금액이 처리 가능한 범위를 벗어났습니다.',
  },
  UNSUPPORTED_CURRENCY: {
    status: BAD_REQUEST,
    message: 'KRW 상품만 주문할 수 있습니다.',
  },
  BUYER_PHONE_REQUIRED: {
    status: BAD_REQUEST,
    message:
      '주문자 연락처가 필요합니다. 프로필에 전화번호를 등록하거나 입력해 주세요.',
  },
  IDEMPOTENCY_KEY_UNAVAILABLE: {
    status: BAD_REQUEST,
    message:
      '이 요청 키로는 주문을 만들 수 없습니다. 주문서를 새로 열어 다시 시도해 주세요.',
  },
  ORDER_NUMBER_GENERATION_FAILED: {
    status: INTERNAL,
    message: '주문번호 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  },
  IDEMPOTENT_REPLAY_FAILED: {
    status: INTERNAL,
    message:
      '이미 처리 중인 주문을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  },

  // ── 리뷰 작성 ──
  TOO_MANY_REVIEW_IMAGES: {
    status: BAD_REQUEST,
    message: '사진은 최대 10장까지 첨부할 수 있습니다.',
  },
  TOO_MANY_REVIEW_VIDEOS: {
    status: BAD_REQUEST,
    message: '동영상은 최대 1개까지 첨부할 수 있습니다.',
  },
  CANNOT_WRITE_REVIEW: {
    status: BAD_REQUEST,
    message: '리뷰를 작성할 수 없는 주문입니다.',
  },
  REVIEW_ALREADY_EXISTS: {
    status: CONFLICT,
    message: '이미 리뷰가 작성된 주문 아이템입니다.',
  },
  INVALID_MEDIA_URL: {
    status: BAD_REQUEST,
    message: '유효하지 않은 미디어 URL입니다.',
  },
  INVALID_THUMBNAIL_URL: {
    status: BAD_REQUEST,
    message: '유효하지 않은 썸네일 URL입니다.',
  },

  // ── 인증 (auth) ──
  OIDC_SESSION_MISSING: {
    status: UNAUTHORIZED,
    message: '소셜 로그인 세션이 만료되었습니다. 다시 시도해 주세요.',
  },
  OIDC_SUBJECT_MISSING: {
    status: UNAUTHORIZED,
    message: '소셜 계정 정보를 확인하지 못했습니다.',
  },
  ACCOUNT_UPSERT_FAILED: {
    status: UNAUTHORIZED,
    message: '계정 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  },
  ACCOUNT_IDENTITY_CONFLICT: {
    status: CONFLICT,
    message: '이미 연동된 소셜 계정입니다.',
  },
  // 존재·타입·비밀번호 오류를 구분하지 않는다(계정 열거 방지) — 문구도 하나로 유지한다.
  INVALID_CREDENTIALS: {
    status: UNAUTHORIZED,
    message: '아이디 또는 비밀번호가 올바르지 않습니다.',
  },
  MISSING_REFRESH_TOKEN: {
    status: UNAUTHORIZED,
    message: '로그인이 필요합니다.',
  },
  INVALID_REFRESH_TOKEN: {
    status: UNAUTHORIZED,
    message: '세션이 만료되었습니다. 다시 로그인해 주세요.',
  },
  CREDENTIAL_NOT_FOUND: {
    status: UNAUTHORIZED,
    message: '자격증명을 찾을 수 없습니다.',
  },
  ROLE_MISMATCH: {
    status: FORBIDDEN,
    message: '이 경로로 로그인할 수 없는 계정입니다.',
  },
  CURRENT_PASSWORD_INVALID: {
    status: UNAUTHORIZED,
    message: '현재 비밀번호가 올바르지 않습니다.',
  },
  PASSWORD_UNCHANGED: {
    status: BAD_REQUEST,
    message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.',
  },
  ACCOUNT_NOT_ACTIVE: {
    status: FORBIDDEN,
    message: '사용할 수 없는 계정 상태입니다.',
  },

  // ── 대화 (conversation) ──
  FAQ_TOPIC_NOT_FOUND: {
    status: NOT_FOUND,
    message: '문의 주제를 찾을 수 없습니다.',
  },
  CONVERSATION_NOT_FOUND: {
    status: NOT_FOUND,
    message: '대화를 찾을 수 없습니다.',
  },
  ACCOUNT_NOT_FOUND: {
    status: UNAUTHORIZED,
    message: '계정을 찾을 수 없습니다.',
  },
  ACCOUNT_DELETED: {
    status: UNAUTHORIZED,
    message: '탈퇴한 계정입니다.',
  },
  // 주문의 BUYER_NOT_USER 와 상황이 다르다 — 이쪽은 "이 기능은 일반 사용자 전용"이다.
  USER_ACCOUNT_REQUIRED: {
    status: FORBIDDEN,
    message: '일반 사용자 계정만 이용할 수 있습니다.',
  },
  USER_PROFILE_NOT_FOUND: {
    status: UNAUTHORIZED,
    message: '사용자 프로필이 없습니다.',
  },
} satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** 카탈로그 메시지. 문구만 필요한 자리(테스트 단언 등)에서 쓴다. */
export function messageOf(code: ErrorCode): string {
  return ERROR_CATALOG[code].message;
}
