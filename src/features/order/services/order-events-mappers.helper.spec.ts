import {
  toSellerOrderUpdateEvent,
  type SellerOrderUpdateRow,
} from '@/features/order/services/order-events-mappers.helper';
import { OrderStatus } from '@/generated/prisma/client';

const DEADLINE = new Date('2026-09-16T09:00:00.000Z');

function row(o: Partial<SellerOrderUpdateRow> = {}): SellerOrderUpdateRow {
  return {
    id: 1n,
    order_number: 'ORD-1',
    status: OrderStatus.SUBMITTED,
    pickup_at: new Date('2026-09-16T10:00:00.000Z'),
    buyer_name: '차차',
    total_price: 30000,
    confirm_deadline_at: DEADLINE,
    updated_at: new Date('2026-09-16T07:00:00.000Z'),
    items: [
      { product_name_snapshot: '딸기 케이크', custom_mode_snapshot: 'NONE' },
    ],
    ...o,
  };
}

describe('toSellerOrderUpdateEvent', () => {
  it('주문 행을 ISO 날짜 문자열 payload로 옮긴다', () => {
    expect(toSellerOrderUpdateEvent('SUBMITTED', row())).toEqual({
      kind: 'SUBMITTED',
      orderId: '1',
      orderNumber: 'ORD-1',
      status: 'SUBMITTED',
      pickupAt: '2026-09-16T10:00:00.000Z',
      buyerName: '차차',
      totalPrice: 30000,
      productName: '딸기 케이크',
      hasCustom: false,
      confirmDeadlineAt: '2026-09-16T09:00:00.000Z',
      updatedAt: '2026-09-16T07:00:00.000Z',
    });
  });

  // 확정·취소 뒤에도 행에 마감이 남으므로 모든 상태를 전수로 본다
  it.each(
    Object.values(OrderStatus).map((status) => ({
      status,
      expected:
        status === OrderStatus.SUBMITTED ? DEADLINE.toISOString() : null,
    })),
  )(
    '마감이 남은 $status 주문의 확정 마감은 $expected이다',
    ({ status, expected }) => {
      expect(
        toSellerOrderUpdateEvent('STATUS_CHANGED', row({ status }))
          .confirmDeadlineAt,
      ).toBe(expected);
    },
  );

  it('결제 도입 전 접수 주문(마감 없음)의 확정 마감은 null이다', () => {
    expect(
      toSellerOrderUpdateEvent('SUBMITTED', row({ confirm_deadline_at: null }))
        .confirmDeadlineAt,
    ).toBeNull();
  });

  it('품목이 없으면 상품명은 빈 문자열, 커스텀 여부는 false다', () => {
    expect(
      toSellerOrderUpdateEvent('STATUS_CHANGED', row({ items: [] })),
    ).toMatchObject({ productName: '', hasCustom: false });
  });
});
