import { HttpException, HttpStatus } from '@nestjs/common';

type MessageParams = Record<string, string | number>;
type MessageTemplate = string | ((params: MessageParams) => string);

interface ErrorEntry {
  status: HttpStatus;
  message: MessageTemplate;
}

/**
 * 에러 코드 카탈로그(D13). `extensions.code`/REST `errorCode`로 나가는 정본이며 메시지는 부속이다.
 * 코드 1개 = status 1개 — 같은 뜻이라도 status가 다르면 코드를 나눈다(예: SESSION_ACCOUNT_MISSING 401 / ACCOUNT_NOT_FOUND 404).
 */
export const ERROR_CATALOG = {
  // ── 공통·인프라
  INTERNAL_ERROR: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: '서버 오류가 발생했습니다.',
  },
  VALIDATION_FAILED: {
    status: HttpStatus.BAD_REQUEST,
    message: '입력값이 올바르지 않습니다.',
  },
  INVALID_ID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'id 형식이 올바르지 않습니다.',
  },
  INVALID_ACCOUNT_ID: {
    status: HttpStatus.BAD_REQUEST,
    message: '계정 id 형식이 올바르지 않습니다.',
  },
  INVALID_CURSOR: {
    status: HttpStatus.BAD_REQUEST,
    message: '커서 형식이 올바르지 않습니다.',
  },
  INVALID_LIKES_CURSOR: {
    status: HttpStatus.BAD_REQUEST,
    message: '좋아요순 커서 형식이 올바르지 않습니다.',
  },
  INVALID_DATE_VALUE: {
    status: HttpStatus.BAD_REQUEST,
    message: '날짜 형식이 올바르지 않습니다.',
  },
  DATE_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ field }) => `${field}은(는) 필수입니다.`,
  },
  INVALID_DECIMAL_VALUE: {
    status: HttpStatus.BAD_REQUEST,
    message: '소수 값 형식이 올바르지 않습니다.',
  },
  TEXT_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: '필수 텍스트가 비어 있습니다.',
  },
  TEXT_TOO_LONG: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ maxLength }) => `텍스트는 ${maxLength}자 이하여야 합니다.`,
  },
  KEYWORD_EMPTY: {
    status: HttpStatus.BAD_REQUEST,
    message: '검색어를 입력해 주세요.',
  },
  KEYWORD_TOO_LONG: {
    status: HttpStatus.BAD_REQUEST,
    message: '검색어는 200자 이하여야 합니다.',
  },

  // ── 인증·권한
  AUTHENTICATION_REQUIRED: {
    status: HttpStatus.UNAUTHORIZED,
    message: '로그인이 필요합니다.',
  },
  SESSION_ACCOUNT_MISSING: {
    status: HttpStatus.UNAUTHORIZED,
    message: '계정을 찾을 수 없습니다.',
  },
  ACCOUNT_DELETED: {
    status: HttpStatus.UNAUTHORIZED,
    message: '탈퇴한 계정입니다.',
  },
  PROFILE_NOT_FOUND: {
    status: HttpStatus.UNAUTHORIZED,
    message: '사용자 프로필을 찾을 수 없습니다.',
  },
  BUYER_ACCOUNT_NOT_ACTIVE: {
    status: HttpStatus.UNAUTHORIZED,
    message: '유효한 사용자 계정이 아닙니다.',
  },
  USER_ONLY: {
    status: HttpStatus.FORBIDDEN,
    message: '일반 사용자 계정만 이용할 수 있습니다.',
  },
  ACCOUNT_TYPE_NOT_ALLOWED: {
    status: HttpStatus.FORBIDDEN,
    message: '이 작업을 수행할 수 없는 계정 유형입니다.',
  },
  PASSWORD_CHANGE_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: '비밀번호를 변경한 뒤 이용할 수 있습니다.',
  },

  // ── 스토리지
  INVALID_CONTENT_TYPE: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ allowed }) =>
      `허용되지 않은 파일 형식입니다. (허용: ${allowed})`,
  },
  FILE_TOO_LARGE: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ maxMb }) =>
      `파일 용량이 허용 한도를 초과했습니다. (최대 ${maxMb}MB)`,
  },
  INVALID_CONTENT_LENGTH: {
    status: HttpStatus.BAD_REQUEST,
    message: '파일 용량은 0보다 커야 합니다.',
  },
  S3_PRESIGN_FAILED: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: '업로드 URL 생성에 실패했습니다.',
  },
  INVALID_PROFILE_IMAGE_URL: {
    status: HttpStatus.BAD_REQUEST,
    message: '업로드 URL로 발급된 프로필 이미지 URL만 저장할 수 있습니다.',
  },
  INVALID_MEDIA_URL: {
    status: HttpStatus.BAD_REQUEST,
    message: '업로드 URL로 발급된 미디어 URL만 저장할 수 있습니다.',
  },
  INVALID_IMAGE_URL: {
    status: HttpStatus.BAD_REQUEST,
    message: '업로드 URL로 발급된 이미지 URL만 저장할 수 있습니다.',
  },

  // ── 프로필·마이페이지
  NAME_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: '이름은 필수입니다.',
  },
  NAME_EMPTY: {
    status: HttpStatus.BAD_REQUEST,
    message: '이름은 비어 있을 수 없습니다.',
  },
  NO_FIELDS_TO_UPDATE: {
    status: HttpStatus.BAD_REQUEST,
    message: '수정할 항목이 없습니다.',
  },
  NICKNAME_LENGTH_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ min, max }) => `닉네임은 ${min}~${max}자여야 합니다.`,
  },
  NICKNAME_INVALID_CHARACTERS: {
    status: HttpStatus.BAD_REQUEST,
    message: '닉네임에 사용할 수 없는 문자가 있습니다.',
  },
  NICKNAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: '이미 사용 중인 닉네임입니다.',
  },
  INVALID_PHONE_FORMAT: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ example }) =>
      `전화번호 형식이 올바르지 않습니다. 예: ${example}`,
  },
  INVALID_BIRTH_DATE: {
    status: HttpStatus.BAD_REQUEST,
    message: '생년월일 형식이 올바르지 않습니다.',
  },
  BIRTH_DATE_TOO_OLD: {
    status: HttpStatus.BAD_REQUEST,
    message: '1900-01-01 이전 생년월일은 입력할 수 없습니다.',
  },
  BIRTH_DATE_IN_FUTURE: {
    status: HttpStatus.BAD_REQUEST,
    message: '생년월일은 오늘 이후일 수 없습니다.',
  },
  INVALID_OFFSET: {
    status: HttpStatus.BAD_REQUEST,
    message: 'offset은 0 이상이어야 합니다.',
  },
  INVALID_LIMIT: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ max }) => `limit은 1~${max} 사이여야 합니다.`,
  },
  SEARCH_HISTORY_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '검색 기록을 찾을 수 없습니다.',
  },
  NOTIFICATION_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '알림을 찾을 수 없습니다.',
  },

  // ── 카탈로그(매장·상품·지역)
  STORE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '매장을 찾을 수 없습니다.',
  },
  PRODUCT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '상품을 찾을 수 없습니다.',
  },
  REGION_GROUP_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '존재하지 않는 1차 지역입니다.',
  },
  INVALID_PRICE_RANGE: {
    status: HttpStatus.BAD_REQUEST,
    message: '최저가는 최고가보다 클 수 없습니다.',
  },
  INVALID_YEAR_MONTH: {
    status: HttpStatus.BAD_REQUEST,
    message: '유효하지 않은 연월 형식입니다. (YYYY-MM)',
  },
  INVALID_DATE: {
    status: HttpStatus.BAD_REQUEST,
    message: '유효하지 않은 날짜 형식입니다. (YYYY-MM-DD)',
  },

  // ── 리뷰·좋아요·신고
  REVIEW_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '리뷰를 찾을 수 없습니다.',
  },
  REVIEW_COMMENT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '댓글을 찾을 수 없습니다.',
  },
  NOT_COMMENT_OWNER: {
    status: HttpStatus.FORBIDDEN,
    message: '본인 댓글만 삭제할 수 있습니다.',
  },
  CANNOT_LIKE_OWN_REVIEW: {
    status: HttpStatus.BAD_REQUEST,
    message: '본인 리뷰에는 좋아요를 누를 수 없습니다.',
  },
  CANNOT_REPORT_OWN_CONTENT: {
    status: HttpStatus.BAD_REQUEST,
    message: '본인이 작성한 리뷰·댓글은 신고할 수 없습니다.',
  },
  ORDER_ITEM_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '주문 아이템을 찾을 수 없습니다.',
  },
  CANNOT_WRITE_REVIEW: {
    status: HttpStatus.BAD_REQUEST,
    message: '리뷰를 작성할 수 없는 주문입니다.',
  },
  REVIEW_ALREADY_EXISTS: {
    status: HttpStatus.CONFLICT,
    message: '이미 리뷰가 작성된 주문 아이템입니다.',
  },
  TOO_MANY_IMAGES: {
    status: HttpStatus.BAD_REQUEST,
    message: '사진은 최대 10장까지 첨부할 수 있습니다.',
  },
  TOO_MANY_VIDEOS: {
    status: HttpStatus.BAD_REQUEST,
    message: '동영상은 최대 1개까지 첨부할 수 있습니다.',
  },

  // ── 주문
  ORDER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '주문을 찾을 수 없습니다.',
  },
  INVALID_ORDER_STATUS: {
    status: HttpStatus.BAD_REQUEST,
    message: '유효하지 않은 주문 상태입니다.',
  },
  ORDER_STATUS_UNCHANGED: {
    status: HttpStatus.BAD_REQUEST,
    message: '이미 해당 상태인 주문입니다.',
  },
  INVALID_ORDER_STATUS_TRANSITION: {
    status: HttpStatus.BAD_REQUEST,
    message: '허용되지 않는 주문 상태 전이입니다.',
  },
  ORDER_NOT_CANCELLABLE: {
    status: HttpStatus.BAD_REQUEST,
    message: '현재 상태에서는 주문을 취소할 수 없습니다.',
  },
  DUPLICATE_OPTION_ITEM: {
    status: HttpStatus.BAD_REQUEST,
    message: '중복된 옵션 선택입니다.',
  },
  INVALID_OPTION_ITEM: {
    status: HttpStatus.BAD_REQUEST,
    message: '해당 상품의 옵션이 아닙니다.',
  },
  OPTION_GROUP_RULE_VIOLATION: {
    status: HttpStatus.BAD_REQUEST,
    message: '옵션 그룹의 선택 규칙을 충족하지 않습니다.',
  },
  OPTION_CUSTOMIZATION_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: '커스텀 정보가 필요한 옵션은 아직 주문할 수 없습니다.',
  },
  PICKUP_NOT_AVAILABLE: {
    status: HttpStatus.BAD_REQUEST,
    message: '선택한 픽업 일시는 예약할 수 없습니다.',
  },
  ORDER_AMOUNT_OUT_OF_RANGE: {
    status: HttpStatus.BAD_REQUEST,
    message: '주문 금액이 처리 가능한 범위를 벗어났습니다.',
  },
  UNSUPPORTED_CURRENCY: {
    status: HttpStatus.BAD_REQUEST,
    message: 'KRW 상품만 주문할 수 있습니다.',
  },
  BUYER_PHONE_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message:
      '주문자 연락처가 필요합니다. 프로필에 전화번호를 등록하거나 입력해 주세요.',
  },
  IDEMPOTENCY_KEY_UNAVAILABLE: {
    status: HttpStatus.BAD_REQUEST,
    message:
      '이 요청 키로는 주문을 만들 수 없습니다. 주문서를 새로 열어 다시 시도해 주세요.',
  },
  IDEMPOTENT_REPLAY_FAILED: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message:
      '이미 처리 중인 주문을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  },
  ORDER_NUMBER_GENERATION_FAILED: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: '주문번호 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  },
} as const satisfies Record<string, ErrorEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export function renderErrorMessage(
  code: ErrorCode,
  params: MessageParams = {},
): string {
  const template: MessageTemplate = ERROR_CATALOG[code].message;
  return typeof template === 'function' ? template(params) : template;
}

export function errorStatus(code: ErrorCode): HttpStatus {
  return ERROR_CATALOG[code].status;
}

/** 도메인 예외 1종. status·메시지는 카탈로그가 결정하고 호출부는 코드(+파라미터)만 넘긴다. */
export class DomainException extends HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, params?: MessageParams) {
    const status = errorStatus(code);
    super(
      { statusCode: status, code, message: renderErrorMessage(code, params) },
      status,
    );
    this.code = code;
  }
}
