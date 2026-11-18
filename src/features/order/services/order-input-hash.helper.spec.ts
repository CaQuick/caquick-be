import { sha256Hex } from '@/common/utils/crypto';
import {
  hashCreateOrderInput,
  type CreateOrderHashInput,
} from '@/features/order/services/order-input-hash.helper';

const BASE: CreateOrderHashInput = {
  productId: 1n,
  optionItemIds: [10n, 11n],
  pickupAt: new Date('2026-09-18T05:00:00.000Z'),
  quantity: 2,
  buyerName: '차차',
  buyerPhone: '010-0000-1111',
  requestNote: '메모',
  expectedTotalPrice: 56000,
};

function hashWith(change: Partial<CreateOrderHashInput>): string {
  return hashCreateOrderInput({ ...BASE, ...change });
}

describe('hashCreateOrderInput', () => {
  it('주문에 저장되는 값이라 정규화 형식을 고정한다(키 정렬·문자열 ID·ISO 시각)', () => {
    expect(hashCreateOrderInput(BASE)).toBe(
      sha256Hex(
        '{"buyerName":"차차","buyerPhone":"010-0000-1111","expectedTotalPrice":56000,' +
          '"optionItemIds":["10","11"],"pickupAt":"2026-09-18T05:00:00.000Z",' +
          '"productId":"1","quantity":2,"requestNote":"메모"}',
      ),
    );
  });

  it.each<[string, Partial<CreateOrderHashInput>]>([
    ['옵션 순서', { optionItemIds: [11n, 10n] }],
    [
      '같은 시각의 다른 표기',
      { pickupAt: new Date('2026-09-18T14:00:00+09:00') },
    ],
  ])('%s만 다르면 같은 해시다', (_case, change) => {
    expect(hashWith(change)).toBe(hashCreateOrderInput(BASE));
  });

  it('quantity 생략·null은 1과 같다', () => {
    const one = hashWith({ quantity: 1 });
    expect(hashWith({ quantity: undefined })).toBe(one);
    expect(hashWith({ quantity: null })).toBe(one);
  });

  it('선택 입력의 생략과 null은 같다', () => {
    const omitted = hashWith({
      buyerName: undefined,
      buyerPhone: undefined,
      requestNote: undefined,
    });
    expect(
      hashWith({ buyerName: null, buyerPhone: null, requestNote: null }),
    ).toBe(omitted);
  });

  it.each<[keyof CreateOrderHashInput, Partial<CreateOrderHashInput>]>([
    ['productId', { productId: 2n }],
    ['optionItemIds', { optionItemIds: [10n] }],
    ['pickupAt', { pickupAt: new Date('2026-09-18T05:30:00.000Z') }],
    ['quantity', { quantity: 3 }],
    ['buyerName', { buyerName: '다른 이름' }],
    ['buyerPhone', { buyerPhone: '010-9999-9999' }],
    ['requestNote', { requestNote: '다른 메모' }],
    ['expectedTotalPrice', { expectedTotalPrice: 56001 }],
  ])('%s가 다르면 해시가 다르다', (_field, change) => {
    expect(hashWith(change)).not.toBe(hashCreateOrderInput(BASE));
  });

  it('값 안의 따옴표가 다음 필드를 흉내 내도 다른 입력으로 본다', () => {
    expect(
      hashWith({
        buyerName: '차차","buyerPhone":"010-0000-1111',
        buyerPhone: null,
      }),
    ).not.toBe(hashWith({ buyerName: '차차', buyerPhone: '010-0000-1111' }));
  });
});
