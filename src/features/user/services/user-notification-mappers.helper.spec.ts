import type { NotificationListRow } from '@/features/user/repositories/user.repository';
import { toNotificationItem } from '@/features/user/services/user-notification-mappers.helper';

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
    store: null,
    product: null,
    order: null,
    ...overrides,
  };
}

describe('toNotificationItem', () => {
  it('연관 엔티티가 없으면 부가 필드를 모두 null로 매핑한다', () => {
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

  it('직접 연결(store/product/review)을 우선 사용한다', () => {
    const item = toNotificationItem(
      baseRow({
        event: 'REVIEW_LIKED',
        store_id: BigInt(10),
        product_id: BigInt(20),
        review_id: BigInt(30),
        store: { store_name: '달콤 케이크' },
        product: { name: '크리스마스 케이크' },
        // 직접 컬럼이 있으면 order 폴백은 쓰지 않는다
        order: {
          items: [
            {
              store_id: BigInt(99),
              product_id: BigInt(98),
              product_name_snapshot: '스냅샷',
              store: { store_name: '다른 매장' },
            },
          ],
        },
      }),
    );

    expect(item).toMatchObject({
      event: 'REVIEW_LIKED',
      storeId: '10',
      storeName: '달콤 케이크',
      productId: '20',
      productName: '크리스마스 케이크',
      reviewId: '30',
    });
  });

  it('직접 컬럼이 없으면 order.items 폴백으로 채운다(상품명은 스냅샷)', () => {
    const item = toNotificationItem(
      baseRow({
        event: 'ORDER_PICKED_UP',
        order_id: BigInt(5),
        order: {
          items: [
            {
              store_id: BigInt(10),
              product_id: BigInt(20),
              product_name_snapshot: '주문 시점 상품명',
              store: { store_name: '해즈 케이크' },
            },
          ],
        },
      }),
    );

    expect(item).toMatchObject({
      orderId: '5',
      storeId: '10',
      storeName: '해즈 케이크',
      productId: '20',
      productName: '주문 시점 상품명',
    });
  });

  it('order.items가 비어 있어도 안전하게 null로 남긴다', () => {
    const item = toNotificationItem(
      baseRow({ order_id: BigInt(5), order: { items: [] } }),
    );

    expect(item).toMatchObject({
      orderId: '5',
      storeId: null,
      storeName: null,
      productId: null,
      productName: null,
    });
  });
});
