export const USER_NOTIFICATION_ERRORS = {
  NOTIFICATION_NOT_FOUND: 'Notification not found.',
  // 커서는 "<createdAtMs>:<id>" 불투명 토큰 — 형식이 다르면 클라이언트 버그다.
  INVALID_CURSOR: 'Invalid notification cursor.',
} as const;
