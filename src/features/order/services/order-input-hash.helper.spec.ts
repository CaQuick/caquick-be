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
  depositorName: '차차맘',
  requestNote: '메모',
  expectedTotalPrice: 56000,
};

function hashWith(change: Partial<CreateOrderHashInput>): string {
  return hashCreateOrderInput({ ...BASE, ...change });
}

type CustomInput = NonNullable<CreateOrderHashInput['custom']>;
type SlotInput = NonNullable<CustomInput['slot']>;
type ThreeDInput = NonNullable<CustomInput['threeD']>;

const SLOT: SlotInput = {
  templateRevision: 2,
  texts: [
    { tokenId: '7', valueText: '축하해' },
    { tokenId: '5', valueText: '민지' },
  ],
  compositeImageUrl: 'https://img/c.png',
  freeEdits: [
    {
      posX: 0,
      posY: 0,
      width: 5000,
      height: 5000,
      descriptionText: '꽃',
      referenceImageUrls: ['https://img/r1.png', 'https://img/r2.png'],
    },
    {
      posX: 5000,
      posY: 5000,
      width: 5000,
      height: 5000,
      descriptionText: '리본',
    },
  ],
};

const deco = (decoId: string) => ({
  kind: 'DECO' as const,
  x: 0.5,
  y: 0.25,
  size: 20,
  effect: { type: 'none', intensity: 50 },
  decoId,
});

const THREE_D: ThreeDInput = {
  design: {
    schemaVersion: 1,
    basic: {
      shape: 'heart',
      size: 'mini',
      flavor: 'cream',
      sheetColor: 'white',
    },
    top: [deco('number-1'), deco('number-2')],
    side: [],
  },
  renderImages: [
    { kind: 'THREE_D_TOP', imageUrl: 'https://img/top.png' },
    { kind: 'THREE_D_FRONT', imageUrl: 'https://img/front.png' },
  ],
};

const slotWith = (change: Partial<SlotInput>) =>
  hashWith({ custom: { slot: { ...SLOT, ...change } } });
const threeDWith = (change: Partial<ThreeDInput>) =>
  hashWith({ custom: { threeD: { ...THREE_D, ...change } } });

describe('hashCreateOrderInput', () => {
  it('주문에 저장되는 값이라 정규화 형식을 고정한다(키 정렬·문자열 ID·ISO 시각)', () => {
    expect(hashCreateOrderInput(BASE)).toBe(
      sha256Hex(
        '{"buyerName":"차차","buyerPhone":"010-0000-1111","depositorName":"차차맘","expectedTotalPrice":56000,' +
          '"optionItemIds":["10","11"],"pickupAt":"2026-09-18T05:00:00.000Z",' +
          '"productId":"1","quantity":2,"requestNote":"메모"}',
      ),
    );
  });

  it('커스텀 입력은 정규형으로 담는다(문구 자리 tokenId 순, 생략한 목록은 빈 배열)', () => {
    expect(
      hashWith({
        custom: {
          slot: {
            templateRevision: 2,
            texts: [{ tokenId: '7', valueText: '축하해' }, { tokenId: '5' }],
            compositeImageUrl: 'https://img/c.png',
          },
        },
      }),
    ).toBe(
      sha256Hex(
        '{"buyerName":"차차","buyerPhone":"010-0000-1111",' +
          '"custom":{"slot":{"compositeImageUrl":"https://img/c.png","freeEdits":[],"templateRevision":2,' +
          '"texts":[{"tokenId":"5"},{"tokenId":"7","valueText":"축하해"}]}},' +
          '"depositorName":"차차맘","expectedTotalPrice":56000,' +
          '"optionItemIds":["10","11"],"pickupAt":"2026-09-18T05:00:00.000Z",' +
          '"productId":"1","quantity":2,"requestNote":"메모"}',
      ),
    );
  });

  it.each<[string, CustomInput | null | undefined]>([
    ['null', null],
    ['빈 객체', {}],
    ['슬롯·3D 모두 null', { slot: null, threeD: null }],
  ])(
    '커스텀이 %s이면 커스텀 없는 주문(도입 전 해시)과 같다',
    (_case, custom) => {
      expect(hashWith({ custom })).toBe(hashCreateOrderInput(BASE));
    },
  );

  it.each<[string, () => string, () => string]>([
    [
      '문구 자리 순서',
      () => slotWith({}),
      () => slotWith({ texts: [...SLOT.texts].reverse() }),
    ],
    [
      '문구 null과 생략',
      () => slotWith({ texts: [{ tokenId: '5', valueText: null }] }),
      () => slotWith({ texts: [{ tokenId: '5' }] }),
    ],
    [
      '자유 편집 생략과 빈 배열',
      () => slotWith({ freeEdits: undefined }),
      () => slotWith({ freeEdits: [] }),
    ],
    [
      '참고 사진 생략과 빈 배열',
      () => slotWith({ freeEdits: [{ ...SLOT.freeEdits![1] }] }),
      () =>
        slotWith({
          freeEdits: [{ ...SLOT.freeEdits![1], referenceImageUrls: [] }],
        }),
    ],
    [
      '렌더 이미지 순서',
      () => threeDWith({}),
      () => threeDWith({ renderImages: [...THREE_D.renderImages].reverse() }),
    ],
  ])('커스텀 입력의 %s만 다르면 같은 해시다', (_case, a, b) => {
    expect(a()).toBe(b());
  });

  it.each<[string, Partial<SlotInput>]>([
    ['템플릿 revision', { templateRevision: 3 }],
    ['문구', { texts: [SLOT.texts[0], { tokenId: '5', valueText: '지수' }] }],
    ['합성 이미지', { compositeImageUrl: 'https://img/d.png' }],
    ['자유 편집 순서', { freeEdits: [...SLOT.freeEdits!].reverse() }],
    [
      '참고 사진 순서',
      {
        freeEdits: [
          {
            ...SLOT.freeEdits![0],
            referenceImageUrls: ['https://img/r2.png', 'https://img/r1.png'],
          },
          SLOT.freeEdits![1],
        ],
      },
    ],
  ])('슬롯 입력의 %s가 다르면 해시가 다르다', (_case, change) => {
    expect(slotWith(change)).not.toBe(slotWith({}));
  });

  it.each<[string, Partial<ThreeDInput>]>([
    [
      '항목 순서(그리는 순서)',
      {
        design: { ...THREE_D.design, top: [...THREE_D.design.top].reverse() },
      },
    ],
    [
      '맛',
      {
        design: {
          ...THREE_D.design,
          basic: { ...THREE_D.design.basic, flavor: 'choco' },
        },
      },
    ],
    [
      '렌더 이미지',
      {
        renderImages: [
          THREE_D.renderImages[0],
          { kind: 'THREE_D_FRONT', imageUrl: 'https://img/other.png' },
        ],
      },
    ],
  ])('3D 입력의 %s가 다르면 해시가 다르다', (_case, change) => {
    expect(threeDWith(change)).not.toBe(threeDWith({}));
  });

  it('슬롯 입력과 3D 입력은 서로 다른 해시다', () => {
    expect(slotWith({})).not.toBe(threeDWith({}));
    expect(slotWith({})).not.toBe(hashCreateOrderInput(BASE));
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
      depositorName: undefined,
      requestNote: undefined,
    });
    expect(
      hashWith({
        buyerName: null,
        buyerPhone: null,
        depositorName: null,
        requestNote: null,
      }),
    ).toBe(omitted);
  });

  it.each<[keyof CreateOrderHashInput, Partial<CreateOrderHashInput>]>([
    ['productId', { productId: 2n }],
    ['optionItemIds', { optionItemIds: [10n] }],
    ['pickupAt', { pickupAt: new Date('2026-09-18T05:30:00.000Z') }],
    ['quantity', { quantity: 3 }],
    ['buyerName', { buyerName: '다른 이름' }],
    ['buyerPhone', { buyerPhone: '010-9999-9999' }],
    ['depositorName', { depositorName: '다른 입금자' }],
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
