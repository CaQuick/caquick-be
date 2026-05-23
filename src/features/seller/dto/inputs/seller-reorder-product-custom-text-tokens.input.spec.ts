import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerReorderProductCustomTextTokensInput } from '@/features/seller/dto/inputs/seller-reorder-product-custom-text-tokens.input';

function build(plain: object): SellerReorderProductCustomTextTokensInput {
  return plainToInstance(SellerReorderProductCustomTextTokensInput, plain);
}

describe('SellerReorderProductCustomTextTokensInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({ templateId: '1', tokenIds: ['a', 'b', 'c'] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('tokenIds 빈 배열 거절', async () => {
    const dto = build({ templateId: '1', tokenIds: [] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('tokenIds');
  });

  it('templateId 누락 거절', async () => {
    const dto = build({ tokenIds: ['a'] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('templateId');
  });
});
