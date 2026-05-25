import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerReorderProductImagesInput } from '@/features/seller/dto/inputs/seller-reorder-product-images.input';

function build(plain: object): SellerReorderProductImagesInput {
  return plainToInstance(SellerReorderProductImagesInput, plain);
}

describe('SellerReorderProductImagesInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({ productId: '1', imageIds: ['10', '11', '12'] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('imageIds 빈 배열 거절', async () => {
    const dto = build({ productId: '1', imageIds: [] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('imageIds');
  });

  it('imageIds 항목이 문자열 아니면 거절', async () => {
    const dto = build({ productId: '1', imageIds: [10, 11] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('imageIds');
  });

  it('imageIds 누락 거절', async () => {
    const dto = build({ productId: '1' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('imageIds');
  });
});
