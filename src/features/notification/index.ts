// 알림 내용(문구·이벤트 매핑)의 단일 소스 — order·user repository가 소비한다.
export {
  buildOrderStatusNotification,
  buildReviewLikedNotification,
  type NotificationPayload,
} from '@/features/notification/services/notification-payloads.helper';
