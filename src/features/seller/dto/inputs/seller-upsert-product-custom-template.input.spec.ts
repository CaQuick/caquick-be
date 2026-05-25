import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpsertProductCustomTemplateInput } from '@/features/seller/dto/inputs/seller-upsert-product-custom-template.input';

function build(plain: object): SellerUpsertProductCustomTemplateInput {
  return plainToInstance(SellerUpsertProductCustomTemplateInput, plain);
}

describe('SellerUpsertProductCustomTemplateInput', () => {
  it('필수 통과', async () => {
    const dto = build({
      productId: '1',
      baseImageUrl: 'https://x/y.jpg',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('isActive 포함 통과', async () => {
    const dto = build({
      productId: '1',
      baseImageUrl: 'https://x/y.jpg',
      isActive: false,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('baseImageUrl 누락 거절', async () => {
    const dto = build({ productId: '1' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('baseImageUrl');
  });
});
