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
};

describe('CreateOrderInput', () => {
  it('필수 필드만으로 통과한다 (quantity/buyer는 optional)', async () => {
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
});
