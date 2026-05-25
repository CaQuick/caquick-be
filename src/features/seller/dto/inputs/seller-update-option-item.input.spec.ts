import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpdateOptionItemInput } from '@/features/seller/dto/inputs/seller-update-option-item.input';

function build(plain: object): SellerUpdateOptionItemInput {
  return plainToInstance(SellerUpdateOptionItemInput, plain);
}

describe('SellerUpdateOptionItemInput', () => {
  it('optionItemId 만 있어도 통과', async () => {
    const dto = build({ optionItemId: '1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('일부 수정 통과', async () => {
    const dto = build({ optionItemId: '1', title: '중', priceDelta: 1000 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('optionItemId 누락 거절', async () => {
    const dto = build({ title: 'x' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('optionItemId');
  });
});
