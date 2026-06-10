import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerSetProductCategoriesInput } from '@/features/seller/dto/inputs/seller-set-product-categories.input';

function build(plain: object): SellerSetProductCategoriesInput {
  return plainToInstance(SellerSetProductCategoriesInput, plain);
}

describe('SellerSetProductCategoriesInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({ productId: '1', categoryIds: ['10', '11'] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('categoryIds 빈 배열 통과 (모든 카테고리 해제)', async () => {
    // 모든 카테고리 연결 해제 의도가 도메인상 정당하므로 DTO 는 허용.
    const dto = build({ productId: '1', categoryIds: [] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('categoryIds 누락 거절', async () => {
    const dto = build({ productId: '1' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('categoryIds');
  });

  it('categoryIds 항목이 문자열 아니면 거절', async () => {
    const dto = build({ productId: '1', categoryIds: [10] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('categoryIds');
  });
});
