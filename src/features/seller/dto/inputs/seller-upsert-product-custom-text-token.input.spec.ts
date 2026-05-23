import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpsertProductCustomTextTokenInput } from '@/features/seller/dto/inputs/seller-upsert-product-custom-text-token.input';

function build(plain: object): SellerUpsertProductCustomTextTokenInput {
  return plainToInstance(SellerUpsertProductCustomTextTokenInput, plain);
}

describe('SellerUpsertProductCustomTextTokenInput', () => {
  it('필수만 통과 (신규)', async () => {
    const dto = build({
      templateId: '1',
      tokenKey: 'name',
      defaultText: '홍길동',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('전체 필드 통과 (수정)', async () => {
    const dto = build({
      tokenId: '5',
      templateId: '1',
      tokenKey: 'name',
      defaultText: '홍길동',
      maxLength: 30,
      sortOrder: 0,
      isRequired: true,
      posX: 100,
      posY: 200,
      width: 300,
      height: 50,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('tokenKey 누락 거절', async () => {
    const dto = build({ templateId: '1', defaultText: '홍길동' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('tokenKey');
  });

  it('defaultText 누락 거절', async () => {
    const dto = build({ templateId: '1', tokenKey: 'name' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('defaultText');
  });

  it('maxLength 0 거절', async () => {
    const dto = build({
      templateId: '1',
      tokenKey: 'name',
      defaultText: '홍길동',
      maxLength: 0,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('maxLength');
  });

  it('width 0 거절', async () => {
    const dto = build({
      templateId: '1',
      tokenKey: 'name',
      defaultText: '홍길동',
      width: 0,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('width');
  });
});
