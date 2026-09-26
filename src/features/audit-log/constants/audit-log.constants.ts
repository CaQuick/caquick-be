// 판매자 화면(내 매장 감사 로그)에 노출하는 대상 종류. 관리자 조작(REVIEW·ACCOUNT 등)은 매장 ID가 달려도 제외한다.
export const SELLER_AUDIT_TARGET_TYPES = [
  'STORE',
  'PRODUCT',
  'ORDER',
  'CONVERSATION',
  'CHANGE_PASSWORD',
] as const;
export type SellerAuditTargetType = (typeof SELLER_AUDIT_TARGET_TYPES)[number];
