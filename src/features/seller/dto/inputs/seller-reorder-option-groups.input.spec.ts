import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerReorderOptionGroupsInput } from '@/features/seller/dto/inputs/seller-reorder-option-groups.input';

function build(plain: object): SellerReorderOptionGroupsInput {
  return plainToInstance(SellerReorderOptionGroupsInput, plain);
}

describe('SellerReorderOptionGroupsInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({ productId: '1', optionGroupIds: ['10', '11'] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('optionGroupIds 빈 배열 거절', async () => {
    const dto = build({ productId: '1', optionGroupIds: [] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('optionGroupIds');
  });

  it('optionGroupIds 항목이 문자열 아니면 거절', async () => {
    const dto = build({ productId: '1', optionGroupIds: [10, 11] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('optionGroupIds');
  });

  it('productId 누락 거절', async () => {
    const dto = build({ optionGroupIds: ['1'] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('productId');
  });
});
