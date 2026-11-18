import {
  toOrderCancellation,
  toOrderItemDetail,
  toOrderItemFreeEdit,
  toOrderRefund,
  toOrderStatusHistory,
  type OrderItemDetailRow,
  type OrderStatusHistoryRow,
} from '@/features/order/services/order-output-mappers.helper';
import type { Refund } from '@/generated/prisma/client';

function itemRow(o: Partial<OrderItemDetailRow> = {}): OrderItemDetailRow {
  return {
    id: 10n,
    store_id: 2n,
    product_id: 3n,
    product_name_snapshot: '레터링 케이크',
    regular_price_snapshot: 40000,
    sale_price_snapshot: 35000,
    quantity: 2,
    item_subtotal_price: 72000,
    option_items: [
      {
        id: 100n,
        group_name_snapshot: '크기',
        option_title_snapshot: '2호',
        option_price_delta_snapshot: 1000,
      },
    ],
    custom_texts: [
      {
        id: 200n,
        token_key_snapshot: 'TOP',
        default_text_snapshot: '축하해',
        value_text: '생일 축하해',
        sort_order: 0,
      },
    ],
    free_edits: [
      {
        id: 300n,
        crop_image_url: 'crop.png',
        description_text: '여기 하트',
        sort_order: 0,
        attachments: [{ id: 400n, image_url: 'ref.png', sort_order: 0 }],
      },
    ],
    ...o,
  };
}

describe('order-output-mappers', () => {
  it('toOrderItemDetail: 스냅샷 컬럼을 짧은 이름으로, id는 문자열로 매핑한다', () => {
    expect(toOrderItemDetail(itemRow())).toEqual({
      id: '10',
      storeId: '2',
      productId: '3',
      productName: '레터링 케이크',
      regularPrice: 40000,
      salePrice: 35000,
      quantity: 2,
      itemSubtotalPrice: 72000,
      optionItems: [
        { id: '100', groupName: '크기', optionTitle: '2호', priceDelta: 1000 },
      ],
      customTexts: [
        {
          id: '200',
          tokenKey: 'TOP',
          defaultText: '축하해',
          valueText: '생일 축하해',
          sortOrder: 0,
        },
      ],
      freeEdits: [
        {
          id: '300',
          cropImageUrl: 'crop.png',
          descriptionText: '여기 하트',
          sortOrder: 0,
          attachments: [{ id: '400', imageUrl: 'ref.png', sortOrder: 0 }],
        },
      ],
    });
  });

  it('옵션·문구·자유 편집이 없으면 빈 배열, 할인가 없으면 null', () => {
    const result = toOrderItemDetail(
      itemRow({
        sale_price_snapshot: null,
        option_items: [],
        custom_texts: [],
        free_edits: [],
      }),
    );
    expect(result.salePrice).toBeNull();
    expect(result.optionItems).toEqual([]);
    expect(result.customTexts).toEqual([]);
    expect(result.freeEdits).toEqual([]);
  });

  it('toOrderItemFreeEdit: 첨부가 없으면 빈 배열', () => {
    expect(
      toOrderItemFreeEdit({
        id: 1n,
        crop_image_url: 'c.png',
        description_text: 'd',
        sort_order: 1,
        attachments: [],
      }),
    ).toEqual({
      id: '1',
      cropImageUrl: 'c.png',
      descriptionText: 'd',
      sortOrder: 1,
      attachments: [],
    });
  });

  it('toOrderStatusHistory: 최초 이력은 fromStatus null, note null 허용, 주체·취소 필드를 그대로 싣는다', () => {
    const changedAt = new Date('2026-09-01T00:00:00.000Z');
    expect(toOrderStatusHistory(historyRow({ changed_at: changedAt }))).toEqual(
      {
        id: '5',
        fromStatus: null,
        toStatus: 'SUBMITTED',
        changedAt,
        note: null,
        actorType: 'ADMIN',
        cancelReason: null,
        cancelFault: null,
        refundAmount: null,
      },
    );
  });

  describe('toOrderCancellation', () => {
    const canceledAt = new Date('2026-09-02T00:00:00.000Z');
    const cancelHistory = historyRow({
      from_status: 'CONFIRMED',
      to_status: 'CANCELED',
      actor_type: 'SELLER',
      cancel_reason: 'OUT_OF_MATERIALS',
      cancel_fault: 'BUYER',
      refund_amount: 10_000,
      note: '재료가 떨어졌어요',
    });

    it('취소 이력과 취소 환불을 합친다(입금 반환은 보지 않는다)', () => {
      const completedAt = new Date('2026-09-03T00:00:00.000Z');
      expect(
        toOrderCancellation({
          status: 'CANCELED',
          canceled_at: canceledAt,
          status_histories: [historyRow(), cancelHistory],
          refunds: [
            {
              kind: 'DEPOSIT_RETURN',
              status: 'AWAITING_ACCOUNT',
              completed_at: null,
            },
            { kind: 'CANCEL', status: 'COMPLETED', completed_at: completedAt },
          ],
        }),
      ).toEqual({
        actorType: 'SELLER',
        reason: 'OUT_OF_MATERIALS',
        reasonLabel: '재료 소진',
        note: '재료가 떨어졌어요',
        fault: 'BUYER',
        refundAmount: 10_000,
        refundStatus: 'COMPLETED',
        refundCompletedAt: completedAt,
        canceledAt,
      });
    });

    it('환불이 없으면 환불 상태는 null이고, 사유가 없는 옛 이력은 기타·0원으로 보인다', () => {
      expect(
        toOrderCancellation({
          status: 'CANCELED',
          canceled_at: null,
          status_histories: [
            {
              ...cancelHistory,
              cancel_reason: null,
              cancel_fault: null,
              refund_amount: null,
            },
          ],
          refunds: [],
        }),
      ).toMatchObject({
        reason: 'OTHER',
        reasonLabel: '기타',
        refundAmount: 0,
        refundStatus: null,
        refundCompletedAt: null,
        canceledAt: cancelHistory.changed_at,
      });
    });

    it('취소되지 않았거나 취소 이력이 없으면 null', () => {
      expect(
        toOrderCancellation({
          status: 'CONFIRMED',
          canceled_at: null,
          status_histories: [cancelHistory],
          refunds: [],
        }),
      ).toBeNull();
      expect(
        toOrderCancellation({
          status: 'CANCELED',
          canceled_at: canceledAt,
          status_histories: [historyRow()],
          refunds: [],
        }),
      ).toBeNull();
    });
  });

  describe('toOrderRefund', () => {
    const requestedAt = new Date('2026-09-02T00:00:00.000Z');
    const refund: Refund = {
      id: 7n,
      order_id: 1n,
      kind: 'CANCEL',
      cancel_order_id: 1n,
      deposit_record_id: null,
      amount: 30_000,
      status: 'AWAITING_ACCOUNT',
      bank_code: null,
      account_holder: null,
      account_number_enc: null,
      account_number_last4: null,
      account_submitted_at: null,
      requested_at: requestedAt,
      completed_at: null,
      completed_by_account_id: null,
      completed_by_label_snapshot: null,
      complete_note: null,
      created_at: requestedAt,
      updated_at: requestedAt,
    };

    it('계좌 입력 전이면 은행·예금주·계좌는 null', () => {
      expect(toOrderRefund(refund)).toEqual({
        id: '7',
        kind: 'CANCEL',
        amount: 30_000,
        status: 'AWAITING_ACCOUNT',
        bank: null,
        accountHolder: null,
        accountNumberMasked: null,
        requestedAt,
        accountSubmittedAt: null,
        completedAt: null,
      });
    });

    it('계좌가 있으면 은행 이름과 끝 4자리 마스킹만 준다(암호문은 내보내지 않는다)', () => {
      expect(
        toOrderRefund({
          ...refund,
          status: 'AWAITING_TRANSFER',
          bank_code: '004',
          account_holder: '홍길동',
          account_number_enc: 'v1.k1.x.y.z',
          account_number_last4: '1234',
          account_submitted_at: requestedAt,
        }),
      ).toMatchObject({
        bank: { code: '004', name: 'KB국민은행' },
        accountHolder: '홍길동',
        accountNumberMasked: '****1234',
        accountSubmittedAt: requestedAt,
      });
    });
  });
});

function historyRow(
  o: Partial<OrderStatusHistoryRow> = {},
): OrderStatusHistoryRow {
  return {
    id: 5n,
    from_status: null,
    to_status: 'SUBMITTED',
    changed_at: new Date('2026-09-01T00:00:00.000Z'),
    note: null,
    actor_type: 'ADMIN',
    cancel_reason: null,
    cancel_fault: null,
    refund_amount: null,
    ...o,
  };
}
