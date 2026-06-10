import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerReorderOptionItemsInput } from '@/features/seller/dto/inputs/seller-reorder-option-items.input';

function build(plain: object): SellerReorderOptionItemsInput {
  return plainToInstance(SellerReorderOptionItemsInput, plain);
}

describe('SellerReorderOptionItemsInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({ optionGroupId: '1', optionItemIds: ['10', '11'] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('optionItemIds 빈 배열 거절', async () => {
    const dto = build({ optionGroupId: '1', optionItemIds: [] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('optionItemIds');
  });

  it('optionGroupId 누락 거절', async () => {
    const dto = build({ optionItemIds: ['1'] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('optionGroupId');
  });
});
