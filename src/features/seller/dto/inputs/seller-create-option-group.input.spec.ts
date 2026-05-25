import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerCreateOptionGroupInput } from '@/features/seller/dto/inputs/seller-create-option-group.input';

function build(plain: object): SellerCreateOptionGroupInput {
  return plainToInstance(SellerCreateOptionGroupInput, plain);
}

describe('SellerCreateOptionGroupInput', () => {
  it('필수만 통과 (SDL 기본값 의존)', async () => {
    const dto = build({ productId: '1', name: '사이즈' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('전체 필드 통과', async () => {
    const dto = build({
      productId: '1',
      name: '사이즈',
      isRequired: true,
      minSelect: 1,
      maxSelect: 2,
      optionRequiresDescription: false,
      optionRequiresImage: false,
      sortOrder: 0,
      isActive: true,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('productId 누락 거절', async () => {
    const dto = build({ name: '사이즈' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('productId');
  });

  it('name 누락 거절', async () => {
    const dto = build({ productId: '1' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('name');
  });

  it('maxSelect 0 거절 (최소 1)', async () => {
    const dto = build({ productId: '1', name: '사이즈', maxSelect: 0 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('maxSelect');
  });

  it('minSelect 음수 거절', async () => {
    const dto = build({ productId: '1', name: '사이즈', minSelect: -1 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('minSelect');
  });
});
