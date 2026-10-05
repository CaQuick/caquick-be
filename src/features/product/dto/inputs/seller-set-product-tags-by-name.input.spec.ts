import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerSetProductTagsByNameInput } from '@/features/product/dto/inputs/seller-set-product-tags-by-name.input';

function build(plain: object): SellerSetProductTagsByNameInput {
  return plainToInstance(SellerSetProductTagsByNameInput, plain);
}

describe('SellerSetProductTagsByNameInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({ productId: '1', names: ['생일', '#레터링'] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('names 빈 배열 통과 (전체 태그 해제)', async () => {
    const dto = build({ productId: '1', names: [] });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('names 누락 거절', async () => {
    const dto = build({ productId: '1' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('names');
  });

  it('문자열이 아닌 요소 거절', async () => {
    const dto = build({ productId: '1', names: ['생일', 1] });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('names');
  });

  it('길이·개수는 DTO가 막지 않는다(서비스 판정)', async () => {
    const dto = build({
      productId: '1',
      names: Array.from({ length: 41 }, () => 'a'.repeat(81)),
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
