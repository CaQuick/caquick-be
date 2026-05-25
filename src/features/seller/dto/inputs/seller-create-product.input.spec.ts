import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerCreateProductInput } from '@/features/seller/dto/inputs/seller-create-product.input';

function build(plain: object): SellerCreateProductInput {
  return plainToInstance(SellerCreateProductInput, plain);
}

describe('SellerCreateProductInput', () => {
  it('필수만 통과', async () => {
    const dto = build({
      name: '딸기 케이크',
      initialImageUrl: 'https://x/y.jpg',
      regularPrice: 30000,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('전체 필드 통과', async () => {
    const dto = build({
      name: '딸기 케이크',
      initialImageUrl: 'https://x/y.jpg',
      description: '신선한 딸기',
      regularPrice: 30000,
      salePrice: 25000,
      currency: 'KRW',
      preparationTimeMinutes: 120,
      isActive: true,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('name 누락 거절', async () => {
    const dto = build({ initialImageUrl: 'x', regularPrice: 1000 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('regularPrice 누락 거절', async () => {
    const dto = build({ name: 'n', initialImageUrl: 'x' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'regularPrice')).toBe(true);
  });

  it('regularPrice 음수 거절', async () => {
    const dto = build({
      name: 'n',
      initialImageUrl: 'x',
      regularPrice: -1,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('regularPrice');
  });

  it('regularPrice 실수 거절 (Int)', async () => {
    const dto = build({
      name: 'n',
      initialImageUrl: 'x',
      regularPrice: 100.5,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('regularPrice');
  });

  it('preparationTimeMinutes 0 거절', async () => {
    const dto = build({
      name: 'n',
      initialImageUrl: 'x',
      regularPrice: 1000,
      preparationTimeMinutes: 0,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('preparationTimeMinutes');
  });
});
