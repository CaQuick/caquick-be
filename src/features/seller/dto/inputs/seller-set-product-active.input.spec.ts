import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerSetProductActiveInput } from '@/features/seller/dto/inputs/seller-set-product-active.input';

function build(plain: object): SellerSetProductActiveInput {
  return plainToInstance(SellerSetProductActiveInput, plain);
}

describe('SellerSetProductActiveInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({ productId: '1', isActive: false });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('productId 누락 거절', async () => {
    const dto = build({ isActive: true });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('productId');
  });

  it('isActive 누락 거절', async () => {
    const dto = build({ productId: '1' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('isActive');
  });

  it('isActive 가 boolean 이 아니면 거절', async () => {
    const dto = build({ productId: '1', isActive: 'true' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('isActive');
  });
});
