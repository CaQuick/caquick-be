import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerAddProductImageInput } from '@/features/seller/dto/inputs/seller-add-product-image.input';

function build(plain: object): SellerAddProductImageInput {
  return plainToInstance(SellerAddProductImageInput, plain);
}

describe('SellerAddProductImageInput', () => {
  it('필수만 통과', async () => {
    const dto = build({ productId: '1', imageUrl: 'https://x/y.jpg' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('sortOrder 포함 통과', async () => {
    const dto = build({
      productId: '1',
      imageUrl: 'https://x/y.jpg',
      sortOrder: 2,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('imageUrl 누락 거절', async () => {
    const dto = build({ productId: '1' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('imageUrl');
  });

  it('sortOrder 가 정수가 아니면 거절', async () => {
    const dto = build({
      productId: '1',
      imageUrl: 'x',
      sortOrder: 1.5,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('sortOrder');
  });
});
