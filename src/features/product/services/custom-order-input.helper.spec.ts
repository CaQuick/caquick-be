import {
  canonicalizeCustomOrderInput,
  type CustomOrderInputSource,
} from '@/features/product/services/custom-order-input.helper';

const SLOT: NonNullable<CustomOrderInputSource['slot']> = {
  templateRevision: 3,
  texts: [
    { tokenId: '12', valueText: '생일 축하해' },
    { tokenId: '11', valueText: null },
  ],
  compositeImageUrl: 'https://img/composite.png',
  freeEdits: [
    {
      posX: 0,
      posY: 0,
      width: 10,
      height: 10,
      descriptionText: '꽃',
      referenceImageUrls: ['https://img/b.png', 'https://img/a.png'],
    },
  ],
};

const THREE_D: NonNullable<CustomOrderInputSource['threeD']> = {
  design: {
    schemaVersion: 1,
    basic: { shape: 'heart', size: 'mini', sheetColor: 'white' },
    top: [
      {
        kind: 'DECO',
        x: 0.2,
        y: 0.3,
        size: 20,
        effect: { type: 'soft', intensity: 0 },
        decoId: 'number-1',
      },
    ],
    side: [],
  },
  renderImages: [
    { kind: 'THREE_D_TOP', imageUrl: 'https://img/top.png' },
    { kind: 'THREE_D_BACK', imageUrl: 'https://img/back.png' },
  ],
};

describe('canonicalizeCustomOrderInput', () => {
  it.each<[string, CustomOrderInputSource]>([
    ['빈 입력', {}],
    ['둘 다 null', { slot: null, threeD: null }],
  ])('%s은 null이다', (_case, custom) => {
    expect(canonicalizeCustomOrderInput(custom)).toBeNull();
  });

  it('문구 자리는 tokenId 순으로 정렬하고 자유 편집·참고 사진 순서는 그대로 둔다', () => {
    expect(canonicalizeCustomOrderInput({ slot: SLOT })).toEqual({
      slot: {
        templateRevision: 3,
        texts: [
          { tokenId: '11', valueText: null },
          { tokenId: '12', valueText: '생일 축하해' },
        ],
        compositeImageUrl: 'https://img/composite.png',
        freeEdits: [
          {
            posX: 0,
            posY: 0,
            width: 10,
            height: 10,
            descriptionText: '꽃',
            referenceImageUrls: ['https://img/b.png', 'https://img/a.png'],
          },
        ],
      },
      threeD: undefined,
    });
  });

  it('생략한 자유 편집·참고 사진은 빈 배열이다', () => {
    const canonical = canonicalizeCustomOrderInput({
      slot: {
        ...SLOT,
        freeEdits: [{ ...SLOT.freeEdits![0], referenceImageUrls: null }],
      },
    });
    expect(canonical).toMatchObject({
      slot: { freeEdits: [{ referenceImageUrls: [] }] },
    });
    expect(
      canonicalizeCustomOrderInput({ slot: { ...SLOT, freeEdits: undefined } }),
    ).toMatchObject({ slot: { freeEdits: [] } });
  });

  it('렌더 이미지는 종류 순으로 정렬하고 3D 항목 순서(그리는 순서)는 그대로 둔다', () => {
    const top = [
      THREE_D.design.top[0],
      { ...THREE_D.design.top[0], decoId: 'number-2' },
    ];
    expect(
      canonicalizeCustomOrderInput({
        threeD: { ...THREE_D, design: { ...THREE_D.design, top } },
      }),
    ).toEqual({
      slot: undefined,
      threeD: {
        design: {
          schemaVersion: 1,
          basic: {
            shape: 'heart',
            size: 'mini',
            design: undefined,
            flavor: undefined,
            sheetColor: 'white',
          },
          top: top.map((item) => ({
            ...item,
            text: undefined,
            color: undefined,
          })),
          side: [],
        },
        renderImages: [
          { kind: 'THREE_D_BACK', imageUrl: 'https://img/back.png' },
          { kind: 'THREE_D_TOP', imageUrl: 'https://img/top.png' },
        ],
      },
    });
  });

  it('구조에 없는 필드는 담지 않는다', () => {
    const canonical = canonicalizeCustomOrderInput({
      slot: { ...SLOT, extra: 'x' } as CustomOrderInputSource['slot'],
    });
    expect(canonical).not.toHaveProperty('slot.extra');
  });
});
