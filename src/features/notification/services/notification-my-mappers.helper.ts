import type { NotificationListRow } from '@/features/notification/repositories/notification.repository';
import type { NotificationItem } from '@/features/notification/types/notification-my-output.type';

/** 매장명·상품명은 생성 시점 스냅샷 컬럼 그대로 — 과거 알림은 07a 마이그레이션 백필이 같은 규칙으로 채웠다. */
export function toNotificationItem(row: NotificationListRow): NotificationItem {
  return {
    id: row.id.toString(),
    type: row.type,
    event: row.event,
    title: row.title,
    body: row.body,
    orderId: row.order_id?.toString() ?? null,
    storeId: row.store_id?.toString() ?? null,
    productId: row.product_id?.toString() ?? null,
    reviewId: row.review_id?.toString() ?? null,
    storeName: row.store_name,
    productName: row.product_name,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}
