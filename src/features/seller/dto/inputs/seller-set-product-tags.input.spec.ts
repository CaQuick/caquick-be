import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerSetProductTagsInput } from '@/features/seller/dto/inputs/seller-set-product-tags.input';

function build(plain: object): SellerSetProductTagsInput {
  return plainToInstance(SellerSetProductTagsInput, plain);
}

describe('SellerSetProductTagsInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({ productId: '1', tagIds: ['10', '11'] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('tagIds 빈 배열 통과 (전체 태그 해제)', async () => {
    const dto = build({ productId: '1', tagIds: [] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('tagIds 누락 거절', async () => {
    const dto = build({ productId: '1' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('tagIds');
  });
});
