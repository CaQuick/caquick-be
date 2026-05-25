import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerCreateOptionItemInput } from '@/features/seller/dto/inputs/seller-create-option-item.input';

function build(plain: object): SellerCreateOptionItemInput {
  return plainToInstance(SellerCreateOptionItemInput, plain);
}

describe('SellerCreateOptionItemInput', () => {
  it('필수만 통과', async () => {
    const dto = build({ optionGroupId: '1', title: '소' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('전체 필드 통과 (priceDelta 음수 허용 — 할인 옵션)', async () => {
    const dto = build({
      optionGroupId: '1',
      title: '소',
      description: '1인용',
      imageUrl: 'https://x/y.jpg',
      priceDelta: -2000,
      sortOrder: 0,
      isActive: true,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('title 누락 거절', async () => {
    const dto = build({ optionGroupId: '1' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('title');
  });

  it('priceDelta 가 정수가 아니면 거절', async () => {
    const dto = build({
      optionGroupId: '1',
      title: '소',
      priceDelta: 100.5,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('priceDelta');
  });
});
