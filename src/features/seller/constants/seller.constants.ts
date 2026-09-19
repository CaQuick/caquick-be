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
