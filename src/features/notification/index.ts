// 알림 내용(문구·이벤트 매핑)의 단일 소스 — order·user repository가 소비한다.
export {
  buildOrderStatusNotification,
  buildReviewLikedNotification,
} from '@/features/notification/services/notification-payloads.helper';
export { NotificationModule } from '@/features/notification/notification.module';
// 알림센터 읽기(미읽 수)와 노출 하한 — 뷰어 카운트 집계가 쓴다.
export { NotificationRepository } from '@/features/notification/repositories/notification.repository';
export { notificationVisibleSince } from '@/features/notification/services/notification-visibility.helper';
