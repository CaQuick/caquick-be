import { NOTIFICATION_VISIBLE_MONTHS } from '@/features/notification/constants/notification.constants';

/** 알림센터 노출 하한(최근 3개월). setMonth는 대상 월에 없는 날짜를 다음 달로 롤오버시키므로(예: 5/31 → 3/3) 하한이 며칠 늦어져 알림이 일찍 숨는다 — 롤오버가 감지되면 대상 월의 말일로 클램프한다. */
export function notificationVisibleSince(): Date {
  const since = new Date();
  const dayOfMonth = since.getDate();
  since.setMonth(since.getMonth() - NOTIFICATION_VISIBLE_MONTHS);
  if (since.getDate() !== dayOfMonth) {
    // 롤오버 발생 — setDate(0)은 이전 달(=대상 월)의 말일로 되돌린다
    since.setDate(0);
  }
  return since;
}
