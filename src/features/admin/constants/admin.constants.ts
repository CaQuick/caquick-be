// ── 자격증명 ──

export const MIN_USERNAME_LENGTH = 4;
export const MAX_USERNAME_LENGTH = 80;
/** 정책: 소문자·숫자·`.`·`_`·`-`만. 대소문자 혼용 username 충돌을 원천 차단한다. */
export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

// ── 계정 텍스트 ──

export const MAX_EMAIL_LENGTH = 320;
export const MAX_ACCOUNT_NAME_LENGTH = 100;

// ── 배너 ──

export const MAX_URL_LENGTH = 2048;
export const MAX_BANNER_TITLE_LENGTH = 200;
export const BANNER_PLACEMENTS = [
  'HOME_MAIN',
  'HOME_SUB',
  'CATEGORY',
  'STORE',
  'SEARCH',
] as const;
export type BannerPlacementValue = (typeof BANNER_PLACEMENTS)[number];
export const BANNER_LINK_TYPES = [
  'NONE',
  'URL',
  'PRODUCT',
  'STORE',
  'CATEGORY',
] as const;
export type BannerLinkTypeValue = (typeof BANNER_LINK_TYPES)[number];

// ── 목록 검색 ──

export const MAX_KEYWORD_LENGTH = 100;
export const ACCOUNT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED'] as const;
export type AccountStatusValue = (typeof ACCOUNT_STATUSES)[number];

// ── 매장 ──

export const STORE_MAP_PROVIDERS = ['NAVER', 'KAKAO', 'NONE'] as const;
export type StoreMapProviderValue = (typeof STORE_MAP_PROVIDERS)[number];

// ── 계정 상태 변경 ──

export const MAX_REASON_LENGTH = 500;

// ── 카테고리·태그 마스터 ──

export const CATEGORY_TYPES = ['EVENT', 'STYLE', 'OTHER'] as const;
export type CategoryTypeValue = (typeof CATEGORY_TYPES)[number];
export const MAX_CATEGORY_NAME_LENGTH = 100;
export const MAX_CATEGORY_DESCRIPTION_LENGTH = 255;
export const MAX_TAG_NAME_LENGTH = 80;

// ── 리뷰 모더레이션 ──

export const REVIEW_REPORT_STATUSES = [
  'PENDING',
  'RESOLVED',
  'REJECTED',
] as const;
export type ReviewReportStatusValue = (typeof REVIEW_REPORT_STATUSES)[number];
export const REVIEW_REPORT_TARGET_TYPES = ['REVIEW', 'REVIEW_COMMENT'] as const;
export type ReviewReportTargetTypeValue =
  (typeof REVIEW_REPORT_TARGET_TYPES)[number];
export const REVIEW_REPORT_ACTIONS = ['DELETE_TARGET', 'REJECT'] as const;
export type ReviewReportActionValue = (typeof REVIEW_REPORT_ACTIONS)[number];

// ── 주문 ──

export const ORDER_STATUSES = [
  'SUBMITTED',
  'CONFIRMED',
  'MADE',
  'PICKED_UP',
  'CANCELED',
] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];
/** 관리자 취소 이력 메모 접두 — 판매자 취소와 구분한다. */
export const ADMIN_CANCEL_NOTE_PREFIX = '[관리자] ';
/** 접두를 붙인 뒤에도 order_status_history.note(500)에 들어가야 한다. */
export const MAX_ADMIN_CANCEL_NOTE_LENGTH =
  MAX_REASON_LENGTH - ADMIN_CANCEL_NOTE_PREFIX.length;

// ── 알림 발송 ──

export const ADMIN_NOTIFICATION_TYPES = ['SYSTEM', 'MARKETING'] as const;
export type AdminNotificationTypeValue =
  (typeof ADMIN_NOTIFICATION_TYPES)[number];
export const ADMIN_NOTIFICATION_TARGET_KINDS = [
  'ALL_USERS',
  'ACCOUNT_IDS',
] as const;
export type AdminNotificationTargetKindValue =
  (typeof ADMIN_NOTIFICATION_TARGET_KINDS)[number];
export const MAX_NOTIFICATION_TITLE_LENGTH = 200;
export const MAX_NOTIFICATION_BODY_LENGTH = 2000;
export const MAX_NOTIFICATION_ACCOUNT_IDS = 500;
/** 전체 발송 fan-out 청크. 청크 단위 createMany이고 청크 사이 트랜잭션은 없다. */
export const NOTIFICATION_FANOUT_BATCH_SIZE = 1000;

// ── 지역 마스터 ──

export const MAX_REGION_NAME_LENGTH = 80;
export const MAX_REGION_SLUG_LENGTH = 120;
/** 정책: 소문자·숫자·`-`만(기존 시드 slug 'sgg-11440' 형식과 호환). */
export const REGION_SLUG_PATTERN = /^[a-z0-9-]+$/;

// ── 감사 로그 ──

export const AUDIT_TARGET_TYPES = [
  'STORE',
  'PRODUCT',
  'ORDER',
  'CONVERSATION',
  'CHANGE_PASSWORD',
  'ACCOUNT',
  'BANNER',
  'CATEGORY',
  'TAG',
  'REGION',
  'REVIEW',
  'REVIEW_COMMENT',
  'REVIEW_REPORT',
  'NOTIFICATION',
] as const;
export type AuditTargetTypeValue = (typeof AUDIT_TARGET_TYPES)[number];
export const AUDIT_ACTION_TYPES = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'STATUS_CHANGE',
] as const;
export type AuditActionTypeValue = (typeof AUDIT_ACTION_TYPES)[number];

// ── 대시보드 ──

export const MAX_DASHBOARD_RANGE_DAYS = 366;
