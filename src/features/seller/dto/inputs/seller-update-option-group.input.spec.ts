import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpdateOptionGroupInput } from '@/features/seller/dto/inputs/seller-update-option-group.input';

function build(plain: object): SellerUpdateOptionGroupInput {
  return plainToInstance(SellerUpdateOptionGroupInput, plain);
}

describe('SellerUpdateOptionGroupInput', () => {
  it('optionGroupId 만 있어도 통과', async () => {
    const dto = build({ optionGroupId: '1' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('일부 필드 수정 통과', async () => {
    const dto = build({
      optionGroupId: '1',
      name: '사이즈',
      maxSelect: 3,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('optionGroupId 누락 거절', async () => {
    const dto = build({ name: '사이즈' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('optionGroupId');
  });

  it('maxSelect 0 거절', async () => {
    const dto = build({ optionGroupId: '1', maxSelect: 0 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('maxSelect');
  });
});
