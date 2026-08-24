import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateOrderInput } from '@/features/order/dto/inputs/create-order.input';

function build(plain: object): CreateOrderInput {
  return plainToInstance(CreateOrderInput, plain);
}

const VALID = {
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
