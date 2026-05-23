import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpdateProductInput } from '@/features/seller/dto/inputs/seller-update-product.input';

function build(plain: object): SellerUpdateProductInput {
  return plainToInstance(SellerUpdateProductInput, plain);
}

describe('SellerUpdateProductInput', () => {
  it('productId 만 있어도 통과', async () => {
    const dto = build({ productId: '1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('일부 필드 수정 통과', async () => {
    const dto = build({ productId: '1', name: '새 이름', salePrice: 5000 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('productId 누락 거절', async () => {
    const dto = build({ name: '새 이름' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('productId');
  });

  it('regularPrice 음수 거절', async () => {
    const dto = build({ productId: '1', regularPrice: -1 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('regularPrice');
  });
});
