import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpdateStoreBasicInfoInput } from '@/features/seller/dto/inputs/seller-update-store-basic-info.input';

function build(plain: object): SellerUpdateStoreBasicInfoInput {
  return plainToInstance(SellerUpdateStoreBasicInfoInput, plain);
}

describe('SellerUpdateStoreBasicInfoInput', () => {
  it('빈 입력 허용 (도메인 "최소 1개" 규칙은 service 책임)', async () => {
    const dto = build({});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('전체 필드 통과', async () => {
    const dto = build({
      storeName: 'Quick Cakes',
      storePhone: '02-1234-5678',
      addressFull: '서울 강남구 ...',
      mapProvider: 'NAVER',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('알 수 없는 mapProvider 거절', async () => {
    const dto = build({ mapProvider: 'GOOGLE' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('mapProvider');
  });

  it('storeName 이 문자열이 아니면 거절', async () => {
    const dto = build({ storeName: 12345 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('storeName');
  });
});
