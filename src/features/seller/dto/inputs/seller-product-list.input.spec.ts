import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerProductListInput } from '@/features/seller/dto/inputs/seller-product-list.input';

function build(plain: object): SellerProductListInput {
  return plainToInstance(SellerProductListInput, plain);
}

describe('SellerProductListInput', () => {
  it('빈 입력 허용', async () => {
    const dto = build({});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('isActive · categoryId · search 허용', async () => {
    const dto = build({
      isActive: true,
      categoryId: '10',
      search: 'cake',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('isActive 가 boolean 이 아니면 거절', async () => {
    const dto = build({ isActive: 'yes' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('isActive');
  });

  it('search 가 문자열이 아니면 거절', async () => {
    const dto = build({ search: 12345 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('search');
  });
});
