import {
  toOrderItemDetail,
  toOrderItemFreeEdit,
  toOrderStatusHistory,
  type OrderItemDetailRow,
} from '@/features/order/services/order-output-mappers.helper';

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

  it('toOrderStatusHistory: 최초 이력은 fromStatus null, note null 허용', () => {
    const changedAt = new Date('2026-09-01T00:00:00.000Z');
    expect(
      toOrderStatusHistory({
        id: 5n,
        from_status: null,
        to_status: 'SUBMITTED',
        changed_at: changedAt,
        note: null,
      }),
    ).toEqual({
      id: '5',
      fromStatus: null,
      toStatus: 'SUBMITTED',
      changedAt,
      note: null,
    });
  });
});
