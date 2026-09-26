import type { NotificationListRow } from '@/features/notification/repositories/notification.repository';
import { toNotificationItem } from '@/features/notification/services/notification-my-mappers.helper';

function baseRow(overrides: Partial<NotificationListRow>): NotificationListRow {
  return {
    id: BigInt(1),
    type: 'SYSTEM',
    event: null,
    title: '제목',
    body: '본문',
    read_at: null,
    created_at: new Date('2026-08-01T00:00:00Z'),
    store_id: null,
    product_id: null,
    order_id: null,
    review_id: null,
    store_name: null,
    product_name: null,
    order_number: null,
    ...overrides,
  };
}

describe('toNotificationItem', () => {
  it('연관 정보가 없으면 부가 필드를 모두 null로 매핑한다', () => {
    const item = toNotificationItem(baseRow({}));

    expect(item).toMatchObject({
      id: '1',
      event: null,
      orderId: null,
      storeId: null,
      productId: null,
      reviewId: null,
      storeName: null,
      productName: null,
    });
  });

  it('연관 ID는 문자열로, 매장명·상품명은 스냅샷 컬럼 그대로 내린다', () => {
    const item = toNotificationItem(
      baseRow({
        type: 'REVIEW_LIKE',
        event: 'REVIEW_LIKED',
        store_id: BigInt(10),
        product_id: BigInt(20),
        review_id: BigInt(30),
        order_id: BigInt(40),
        store_name: '달콤 케이크',
        product_name: '주문 시점 상품명',
        order_number: 'O-1',
        read_at: new Date('2026-08-02T00:00:00Z'),
      }),
    );

    expect(item).toMatchObject({
      event: 'REVIEW_LIKED',
      storeId: '10',
      productId: '20',
      reviewId: '30',
      orderId: '40',
      storeName: '달콤 케이크',
      productName: '주문 시점 상품명',
      readAt: new Date('2026-08-02T00:00:00Z'),
    });
  });
});
