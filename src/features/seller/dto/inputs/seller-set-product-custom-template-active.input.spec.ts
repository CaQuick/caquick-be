import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerSetProductCustomTemplateActiveInput } from '@/features/seller/dto/inputs/seller-set-product-custom-template-active.input';

function build(plain: object): SellerSetProductCustomTemplateActiveInput {
  return plainToInstance(SellerSetProductCustomTemplateActiveInput, plain);
}

describe('SellerSetProductCustomTemplateActiveInput', () => {
  it('정상 통과', async () => {
    const dto = build({ templateId: '1', isActive: true });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('templateId 누락 거절', async () => {
    const dto = build({ isActive: true });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('templateId');
  });

  it('isActive 누락 거절', async () => {
    const dto = build({ templateId: '1' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('isActive');
  });
});
