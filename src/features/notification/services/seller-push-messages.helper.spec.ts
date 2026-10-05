import {
  buildBuyerMessagePush,
  buildOrderSubmittedPush,
  formatKstPickupAt,
} from '@/features/notification/services/seller-push-messages.helper';

describe('seller-push-messages.helper', () => {
  // UTC → KST(+9), 월·일은 0 채움 없이, 시·분은 두 자리
  it.each([
    ['2026-10-05T03:05:00.000Z', '10/5 12:05'],
    ['2026-10-05T15:30:00.000Z', '10/6 00:30'],
    ['2026-12-31T16:00:00.000Z', '1/1 01:00'],
    ['2026-03-09T00:00:00.000Z', '3/9 09:00'],
  ])('formatKstPickupAt(%s) → %s', (iso, expected) => {
    expect(formatKstPickupAt(new Date(iso))).toBe(expected);
  });

  it('주문 접수: 상품명·수량·픽업 시각(KST) 본문, 딥링크 data는 kind·orderId', () => {
    expect(
      buildOrderSubmittedPush({
        orderId: '42',
        orderNumber: 'ORD-1',
        buyerAccountId: '7',
        storeId: '3',
        storeName: '케이크샵',
        productId: '9',
        productName: '레터링 케이크',
        quantity: 2,
        pickupAt: '2026-10-05T03:05:00.000Z',
        totalPrice: 50000,
      }),
    ).toEqual({
      title: '새 주문',
      body: '레터링 케이크 2개 · 픽업 10/5 12:05',
      data: { kind: 'ORDER_SUBMITTED', orderId: '42' },
    });
  });

  it('구매자 문의: 본문은 preview 그대로, data는 kind·conversationId', () => {
    expect(
      buildBuyerMessagePush({
        conversationId: '11',
        storeId: '3',
        buyerAccountId: '7',
        messageId: '99',
        preview: '픽업 시간 바꿀 수 있나요?',
        messageCreatedAt: '2026-10-05T03:05:00.000Z',
      }),
    ).toEqual({
      title: '새 문의',
      body: '픽업 시간 바꿀 수 있나요?',
      data: { kind: 'BUYER_MESSAGE', conversationId: '11' },
    });
  });
});
