/**
 * 관리자 동적 에러 메시지.
 *
 * 정적 문구는 전부 common/errors 카탈로그로 옮겼다. 발송 건수가 런타임 값이라
 * 카탈로그의 고정 문자열로 표현할 수 없는 것만 여기 남는다.
 */

// ── 알림 발송 ──

/** 청크 사이 실패. 그때까지 저장된 건수는 감사 로그(interrupted)에 남는다 — 재실행은 그만큼 중복. */
export const NOTIFICATION_FANOUT_INTERRUPTED = (sentCount: number): string =>
  `Notification fan-out was interrupted after ${sentCount} deliveries; re-sending would duplicate them (see audit log).`;
