import type { NotificationListRow } from '@/features/user/repositories/user.repository';
import type { NotificationItem } from '@/features/user/types/user-output.type';

/**
 * 알림 row → 출력 매핑. DI-free 순수 함수.
 *
 * 연관 ID·매장명은 직접 컬럼(store/product) 우선, 없으면 order.items 폴백 —
 * 연관 ID를 저장하지 않던 과거 주문 알림도 서브라인·딥링크 정보를 채우기 위함.
 * 단 상품명은 주문 연결 알림이면 항상 주문 시점 스냅샷(이후 개명·삭제와 무관).
 */
export function toNotificationItem(row: NotificationListRow): NotificationItem {
  const orderItem = row.order?.items[0] ?? null;

  const storeId = row.store_id ?? orderItem?.store_id ?? null;
  const storeName =
    row.store?.store_name ?? orderItem?.store.store_name ?? null;
  const productId = row.product_id ?? orderItem?.product_id ?? null;
  // 주문 연결 알림은 product_id가 저장돼 있어도 주문 시점 스냅샷을 우선한다
  // (SDL 계약) — 체크아웃 이후 상품 개명이 알림 문맥을 바꾸면 안 된다.
  // 주문이 없는 알림(리뷰 좋아요 등)만 현재 상품명을 쓴다.
  const productName = orderItem
    ? orderItem.product_name_snapshot
    : (row.product?.name ?? null);

  return {
    id: row.id.toString(),
    type: row.type,
    event: row.event,
    title: row.title,
    body: row.body,
    orderId: row.order_id?.toString() ?? null,
    storeId: storeId?.toString() ?? null,
    productId: productId?.toString() ?? null,
    reviewId: row.review_id?.toString() ?? null,
    storeName,
    productName,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}
