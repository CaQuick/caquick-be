import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateOrderInput } from '@/features/order/dto/inputs/create-order.input';

function build(plain: object): CreateOrderInput {
  return plainToInstance(CreateOrderInput, plain);
}

const VALID = {
  idempotencyKey: 'a1b2c3d4-e5f6',
  productId: '1',
  optionItemIds: ['10', '11'],
  pickupAt: new Date('2026-09-18T05:00:00.000Z'),
  expectedTotalPrice: 25000,
};

describe('CreateOrderInput', () => {
  it('필수 필드만으로 통과한다 (quantity/buyer/requestNote는 optional)', async () => {
    expect(await validate(build(VALID))).toHaveLength(0);
  });

  it('buyer 필드·quantity 포함 통과', async () => {
    const errors = await validate(
      build({
        ...VALID,
        quantity: 3,
        buyerName: '차차',
        buyerPhone: '010-0000-1111',
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('idempotencyKey는 8자 미만·64자 초과·공백 포함을 거절한다', async () => {
    for (const idempotencyKey of ['short7k', 'k'.repeat(65), 'has space-key']) {
      const errors = await validate(build({ ...VALID, idempotencyKey }));
      expect(errors.map((e) => e.property)).toContain('idempotencyKey');
    }
  });

  it('idempotencyKey 경계 길이(8자·64자)는 통과한다', async () => {
    for (const idempotencyKey of ['k'.repeat(8), 'k'.repeat(64)]) {
      expect(await validate(build({ ...VALID, idempotencyKey }))).toHaveLength(
        0,
      );
    }
  });

  it('optionItemIds가 배열이 아니면 거절한다', async () => {
    const errors = await validate(build({ ...VALID, optionItemIds: '10' }));
    expect(errors[0].property).toBe('optionItemIds');
  });

  it('pickupAt이 Date가 아니면 거절한다', async () => {
    const errors = await validate(build({ ...VALID, pickupAt: 'not-a-date' }));
    expect(errors[0].property).toBe('pickupAt');
  });

  it('quantity 0·100은 범위 위반으로 거절한다', async () => {
    expect((await validate(build({ ...VALID, quantity: 0 })))[0].property).toBe(
      'quantity',
    );
    expect(
      (await validate(build({ ...VALID, quantity: 100 })))[0].property,
    ).toBe('quantity');
  });

  it('buyerName 빈 문자열은 거절한다', async () => {
    const errors = await validate(build({ ...VALID, buyerName: '' }));
    expect(errors[0].property).toBe('buyerName');
  });

  it('buyerPhone은 010-XXXX-XXXX 형식만 허용한다', async () => {
    expect(
      (await validate(build({ ...VALID, buyerPhone: 'abc' })))[0].property,
    ).toBe('buyerPhone');
    expect(
      (await validate(build({ ...VALID, buyerPhone: '01000001111' })))[0]
        .property,
    ).toBe('buyerPhone');
    expect(
      await validate(build({ ...VALID, buyerPhone: '010-0000-1111' })),
    ).toHaveLength(0);
  });

  it.each<[string, unknown]>([
    ['누락', undefined],
    ['음수', -1],
    ['소수', 100.5],
    ['문자열', '25000'],
  ])('expectedTotalPrice %s는 거절한다', async (_case, expectedTotalPrice) => {
    const errors = await validate(build({ ...VALID, expectedTotalPrice }));
    expect(errors.map((e) => e.property)).toEqual(['expectedTotalPrice']);
  });

  it('expectedTotalPrice 0은 통과한다', async () => {
    expect(
      await validate(build({ ...VALID, expectedTotalPrice: 0 })),
    ).toHaveLength(0);
  });

  it('requestNote는 500자까지 허용하고 501자는 거절한다', async () => {
    expect(
      await validate(build({ ...VALID, requestNote: '가'.repeat(500) })),
    ).toHaveLength(0);
    const errors = await validate(
      build({ ...VALID, requestNote: '가'.repeat(501) }),
    );
    expect(errors.map((e) => e.property)).toEqual(['requestNote']);
  });

  describe('custom', () => {
    // 전역 ValidationPipe와 같은 옵션 — 데코레이터가 빠진 중첩 필드는 여기서 거절된다
    const STRICT = { whitelist: true, forbidNonWhitelisted: true };
    const SLOT = {
      templateRevision: 1,
      texts: [{ tokenId: '1', valueText: '축하해' }, { tokenId: '2' }],
      compositeImageUrl: 'https://img/c.png',
      freeEdits: [
        {
          posX: 0,
          posY: 0,
          width: 10,
          height: 10,
          descriptionText: '꽃',
          referenceImageUrls: ['https://img/r.png'],
        },
      ],
    };
    const THREE_D = {
      design: {
        schemaVersion: 1,
        basic: {
          shape: 'heart',
          size: 'mini',
          design: null,
          flavor: 'cream',
          sheetColor: 'white',
        },
        top: [
          {
            kind: 'TEXT',
            x: 0.5,
            y: 0.5,
            size: 8,
            effect: { type: 'none', intensity: 50 },
            text: '축하해',
            color: '#000000',
          },
        ],
        side: [
          {
            kind: 'DECO',
            x: 0.1,
            y: 0.2,
            size: 20,
            effect: { type: 'soft', intensity: 0 },
            decoId: 'number-1',
          },
        ],
      },
      renderImages: [{ kind: 'THREE_D_TOP', imageUrl: 'https://img/t.png' }],
    };

    it.each([
      ['슬롯형', { slot: SLOT }],
      ['3D', { threeD: THREE_D }],
      ['자유 편집·참고 사진 생략', { slot: { ...SLOT, freeEdits: undefined } }],
    ])(
      '%s 입력의 모든 필드가 화이트리스트를 통과한다',
      async (_case, custom) => {
        expect(
          await validate(build({ ...VALID, custom }), STRICT),
        ).toHaveLength(0);
      },
    );

    it.each<[string, object]>([
      [
        '문구 자리 tokenId가 숫자',
        { slot: { ...SLOT, texts: [{ tokenId: 1 }] } },
      ],
      [
        '모르는 필드',
        { slot: { ...SLOT, texts: [{ tokenId: '1', extra: 'x' }] } },
      ],
      [
        '자유 편집 좌표가 문자열',
        { slot: { ...SLOT, freeEdits: [{ ...SLOT.freeEdits[0], posX: '1' }] } },
      ],
      [
        '합성 이미지 URL 2049자',
        { slot: { ...SLOT, compositeImageUrl: 'h'.repeat(2049) } },
      ],
      [
        '렌더 이미지 종류가 enum 밖',
        {
          threeD: {
            ...THREE_D,
            renderImages: [{ kind: 'SIDE', imageUrl: 'https://img/t.png' }],
          },
        },
      ],
      [
        '3D 항목 종류가 enum 밖',
        {
          threeD: {
            ...THREE_D,
            design: {
              ...THREE_D.design,
              top: [{ ...THREE_D.design.top[0], kind: 'IMAGE' }],
            },
          },
        },
      ],
      [
        '효과 강도가 소수',
        {
          threeD: {
            ...THREE_D,
            design: {
              ...THREE_D.design,
              side: [
                {
                  ...THREE_D.design.side[0],
                  effect: { type: 'soft', intensity: 1.5 },
                },
              ],
            },
          },
        },
      ],
      [
        '디자인 basic 누락',
        {
          threeD: {
            ...THREE_D,
            design: { ...THREE_D.design, basic: undefined },
          },
        },
      ],
    ])(
      '중첩 입력의 형식 오류(%s)는 custom에서 거절한다',
      async (_case, custom) => {
        const errors = await validate(build({ ...VALID, custom }), STRICT);
        expect(errors.map((e) => e.property)).toEqual(['custom']);
      },
    );
  });
});
