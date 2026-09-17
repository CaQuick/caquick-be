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
  ROUTE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '요청한 경로를 찾을 수 없습니다.',
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
  // ── 판매자
  SELLER_ONLY: {
    status: HttpStatus.FORBIDDEN,
    message: '판매자 계정만 이용할 수 있습니다.',
  },
  DUPLICATE_IDS: {
    status: HttpStatus.BAD_REQUEST,
    message: '중복된 id가 있습니다.',
  },
  INVALID_TIME_VALUE: {
    status: HttpStatus.BAD_REQUEST,
    message: '시간 형식이 올바르지 않습니다.',
  },
  INVALID_CURRENCY_FORMAT: {
    status: HttpStatus.BAD_REQUEST,
    message: '통화 코드 형식이 올바르지 않습니다.',
  },
  FIELD_OUT_OF_RANGE: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ field, min, max }) =>
      `${field}은(는) ${min}~${max} 사이여야 합니다.`,
  },
  IDS_LENGTH_MISMATCH: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ field }) => `${field} 개수가 일치하지 않습니다.`,
  },
  INVALID_IDS: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ field }) => `${field}에 유효하지 않은 id가 있습니다.`,
  },
  SALE_PRICE_EXCEEDS_REGULAR: {
    status: HttpStatus.BAD_REQUEST,
    message: '할인가는 정가 이하여야 합니다.',
  },
  PRODUCT_IMAGE_LIMIT_EXCEEDED: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ max }) => `상품 이미지는 최대 ${max}장까지 등록할 수 있습니다.`,
  },
  PRODUCT_IMAGE_MIN_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: '상품 이미지는 1장 이상 필요합니다.',
  },
  PRODUCT_IMAGE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '상품 이미지를 찾을 수 없습니다.',
  },
  OPTION_GROUP_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '옵션 그룹을 찾을 수 없습니다.',
  },
  OPTION_ITEM_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '옵션 항목을 찾을 수 없습니다.',
  },
  INVALID_SELECT_RANGE: {
    status: HttpStatus.BAD_REQUEST,
    message: 'minSelect/maxSelect 값이 올바르지 않습니다.',
  },
  MAX_SELECT_BELOW_MIN: {
    status: HttpStatus.BAD_REQUEST,
    message: 'maxSelect는 minSelect 이상이어야 합니다.',
  },
  CUSTOM_TEMPLATE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '커스텀 템플릿을 찾을 수 없습니다.',
  },
  CUSTOM_TEXT_TOKEN_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '커스텀 텍스트 토큰을 찾을 수 없습니다.',
  },
  INVALID_DAY_OF_WEEK: {
    status: HttpStatus.BAD_REQUEST,
    message: 'dayOfWeek는 0~6이어야 합니다.',
  },
  OPEN_CLOSE_TIME_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'openTime과 closeTime이 필요합니다.',
  },
  CLOSE_BEFORE_OPEN: {
    status: HttpStatus.BAD_REQUEST,
    message: 'closeTime은 openTime보다 늦어야 합니다.',
  },
  SPECIAL_CLOSURE_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '임시 휴무를 찾을 수 없습니다.',
  },
  DAILY_CAPACITY_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '일별 수용량을 찾을 수 없습니다.',
  },
  FAQ_TOPIC_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'FAQ 주제를 찾을 수 없습니다.',
  },
  INVALID_AUDIT_TARGET_TYPE: {
    status: HttpStatus.BAD_REQUEST,
    message: '감사 로그 대상 유형이 올바르지 않습니다.',
  },
  CONVERSATION_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '대화를 찾을 수 없습니다.',
  },
  BODY_TEXT_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'TEXT 형식에는 bodyText가 필요합니다.',
  },
  BODY_HTML_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'HTML 형식에는 bodyHtml이 필요합니다.',
  },
  INVALID_BODY_FORMAT: {
    status: HttpStatus.BAD_REQUEST,
    message: '본문 형식이 올바르지 않습니다.',
  },
  CANCELLATION_NOTE_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: '취소 사유가 필요합니다.',
  },
  // ── 관리자
  ADMIN_ONLY: {
    status: HttpStatus.FORBIDDEN,
    message: '관리자 계정만 이용할 수 있습니다.',
  },
  ACCOUNT_NOT_ACTIVE: {
    status: HttpStatus.FORBIDDEN,
    message: '활성 상태의 계정이 아닙니다.',
  },
  ACCOUNT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '계정을 찾을 수 없습니다.',
  },
  USERNAME_TAKEN: {
    status: HttpStatus.BAD_REQUEST,
    message: '이미 사용 중인 아이디입니다.',
  },
  SELLER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '판매자 계정을 찾을 수 없습니다.',
  },
  USER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '사용자 계정을 찾을 수 없습니다.',
  },
  CANNOT_CHANGE_OWN_STATUS: {
    status: HttpStatus.FORBIDDEN,
    message: '본인 계정의 상태는 변경할 수 없습니다.',
  },
  CANNOT_CHANGE_ADMIN_STATUS: {
    status: HttpStatus.FORBIDDEN,
    message: '관리자 계정의 상태는 변경할 수 없습니다.',
  },
  ONLY_ACTIVE_CAN_BE_SUSPENDED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'ACTIVE 상태의 계정만 정지할 수 있습니다.',
  },
  ONLY_SUSPENDED_CAN_BE_REINSTATED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'SUSPENDED 상태의 계정만 복구할 수 있습니다.',
  },
  CATEGORY_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '카테고리를 찾을 수 없습니다.',
  },
  CATEGORY_NAME_TAKEN: {
    status: HttpStatus.BAD_REQUEST,
    message: '같은 유형에 이미 사용 중인 카테고리 이름입니다.',
  },
  TAG_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '태그를 찾을 수 없습니다.',
  },
  TAG_NAME_TAKEN: {
    status: HttpStatus.BAD_REQUEST,
    message: '이미 사용 중인 태그 이름입니다.',
  },
  REVIEW_REPORT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '리뷰 신고를 찾을 수 없습니다.',
  },
  REVIEW_REPORT_ALREADY_RESOLVED: {
    status: HttpStatus.BAD_REQUEST,
    message: '이미 처리된 리뷰 신고입니다.',
  },
  REGION_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '지역을 찾을 수 없습니다.',
  },
  PARENT_REGION_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'parentId는 활성 1차 지역이어야 합니다.',
  },
  REGION_SLUG_TAKEN: {
    status: HttpStatus.BAD_REQUEST,
    message: '이미 사용 중인 지역 slug입니다.',
  },
  REGION_HAS_STORES: {
    status: HttpStatus.BAD_REQUEST,
    message: '해당 지역에 연결된 매장이 있습니다.',
  },
  REGION_HAS_CHILDREN: {
    status: HttpStatus.BAD_REQUEST,
    message: '해당 지역에 활성 하위 지역이 있습니다.',
  },
  REGION_HAS_ACTIVE_CHILDREN: {
    status: HttpStatus.BAD_REQUEST,
    message:
      '1차 지역을 비활성화하려면 활성 하위 지역을 먼저 비활성화해야 합니다.',
  },
  REGION_PARENT_INACTIVE: {
    status: HttpStatus.BAD_REQUEST,
    message: '상위 지역이 비활성이거나 삭제되었습니다.',
  },
  INVALID_DATE_RANGE: {
    status: HttpStatus.BAD_REQUEST,
    message: 'from은 to보다 늦을 수 없습니다.',
  },
  DASHBOARD_RANGE_TOO_LONG: {
    status: HttpStatus.BAD_REQUEST,
    message: '조회 기간은 366일 이하여야 합니다.',
  },
  REGION_NOT_SELECTABLE: {
    status: HttpStatus.BAD_REQUEST,
    message: 'regionId는 활성 2차 지역이어야 합니다.',
  },
  BANNER_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: '배너를 찾을 수 없습니다.',
  },
  LINK_URL_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'URL 링크 유형에는 linkUrl이 필요합니다.',
  },
  LINK_PRODUCT_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'PRODUCT 링크 유형에는 linkProductId가 필요합니다.',
  },
  LINK_STORE_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'STORE 링크 유형에는 linkStoreId가 필요합니다.',
  },
  LINK_CATEGORY_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'CATEGORY 링크 유형에는 linkCategoryId가 필요합니다.',
  },
  LINK_FIELDS_MISMATCH: {
    status: HttpStatus.BAD_REQUEST,
    message: '링크 필드가 linkType과 일치하지 않습니다.',
  },
  LINK_PRODUCT_NOT_VISIBLE: {
    status: HttpStatus.NOT_FOUND,
    message: '링크 상품이 없거나 노출 상태가 아닙니다(비활성·삭제·매장 숨김).',
  },
  LINK_STORE_NOT_VISIBLE: {
    status: HttpStatus.NOT_FOUND,
    message: '링크 매장이 없거나 노출 상태가 아닙니다(비활성·삭제).',
  },
  LINK_CATEGORY_NOT_VISIBLE: {
    status: HttpStatus.NOT_FOUND,
    message: '링크 카테고리가 없거나 노출 상태가 아닙니다(비활성·삭제).',
  },
  CATEGORY_PLACEMENT_REQUIRES_CATEGORY_LINK: {
    status: HttpStatus.BAD_REQUEST,
    message: 'CATEGORY 배치에는 linkType CATEGORY가 필요합니다.',
  },
  CATEGORY_PLACEMENT_REQUIRES_EVENT_CATEGORY: {
    status: HttpStatus.BAD_REQUEST,
    message: 'CATEGORY 배치에는 EVENT 카테고리 링크가 필요합니다.',
  },
  INVALID_EXPOSURE_WINDOW: {
    status: HttpStatus.BAD_REQUEST,
    message: 'startsAt은 endsAt보다 빨라야 합니다.',
  },
  NOTIFICATION_FANOUT_INTERRUPTED: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    // 청크 사이 실패. 그때까지 저장된 건수는 감사 로그(interrupted)에 남는다 — 재실행은 그만큼 중복.
    message: ({ sentCount }) =>
      `알림 발송이 ${sentCount}건 이후 중단되었습니다. 재발송 시 중복되므로 감사 로그를 확인하세요.`,
  },
  // ── 인증(로그인·토큰)
  INVALID_ACCESS_TOKEN: {
    status: HttpStatus.UNAUTHORIZED,
    message: '액세스 토큰이 유효하지 않습니다.',
  },
  INVALID_CREDENTIALS: {
    status: HttpStatus.UNAUTHORIZED,
    // 존재·타입·비밀번호 오류를 구분하지 않는다(계정 열거 방지)
    message: '아이디 또는 비밀번호가 올바르지 않습니다.',
  },
  MISSING_REFRESH_TOKEN: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'refresh 토큰이 없습니다.',
  },
  INVALID_REFRESH_TOKEN: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'refresh 토큰이 유효하지 않습니다.',
  },
  CREDENTIAL_NOT_FOUND: {
    status: HttpStatus.UNAUTHORIZED,
    message: '자격증명을 찾을 수 없습니다.',
  },
  ROLE_MISMATCH: {
    status: HttpStatus.FORBIDDEN,
    message: '이 경로에서 사용할 수 없는 계정 유형입니다.',
  },
  CURRENT_PASSWORD_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: '현재 비밀번호가 올바르지 않습니다.',
  },
  PASSWORD_UNCHANGED: {
    status: HttpStatus.BAD_REQUEST,
    message: '새 비밀번호는 현재 비밀번호와 달라야 합니다.',
  },
  OIDC_SESSION_MISSING: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'OIDC 세션이 없거나 만료되었습니다.',
  },
  OIDC_SUBJECT_MISSING: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'OIDC ID 토큰에 sub 클레임이 없습니다.',
  },
  ACCOUNT_UPSERT_FAILED: {
    status: HttpStatus.UNAUTHORIZED,
    message: '계정 생성 또는 갱신에 실패했습니다.',
  },
  ACCOUNT_IDENTITY_CONFLICT: {
    status: HttpStatus.CONFLICT,
    message: '이미 연동된 소셜 계정입니다.',
  },
  UNSUPPORTED_OIDC_PROVIDER: {
    status: HttpStatus.BAD_REQUEST,
    message: ({ provider }) => `지원하지 않는 OIDC 제공자입니다: ${provider}`,
  },
  DEV_ONLY_ENDPOINT: {
    status: HttpStatus.FORBIDDEN,
    message: '개발 환경에서만 사용할 수 있는 엔드포인트입니다.',
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
