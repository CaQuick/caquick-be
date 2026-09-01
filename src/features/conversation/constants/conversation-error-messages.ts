export const CONVERSATION_ERRORS = {
  STORE_NOT_FOUND: 'Store not found.',
  FAQ_TOPIC_NOT_FOUND: 'FAQ topic not found.',
  // 활성 USER 판정 실패 메시지 — user feature와 동일 의미론(판정은 정책 헬퍼 공유)
  ACCOUNT_NOT_FOUND: 'Account not found.',
  ACCOUNT_DELETED: 'Account is deleted.',
  NOT_USER: 'Only USER account is allowed.',
  PROFILE_INACTIVE: 'User profile not found.',
} as const;
