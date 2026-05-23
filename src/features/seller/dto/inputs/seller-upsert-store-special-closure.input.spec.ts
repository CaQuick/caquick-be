import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpsertStoreSpecialClosureInput } from '@/features/seller/dto/inputs/seller-upsert-store-special-closure.input';

function build(plain: object): SellerUpsertStoreSpecialClosureInput {
  return plainToInstance(SellerUpsertStoreSpecialClosureInput, plain);
}

describe('SellerUpsertStoreSpecialClosureInput', () => {
  it('필수만 통과 (신규)', async () => {
    const dto = build({ closureDate: new Date('2026-08-15') });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('closureId + reason 포함 통과 (수정)', async () => {
    const dto = build({
      closureId: '1',
      closureDate: new Date('2026-08-15'),
      reason: '광복절 휴무',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('closureDate 누락 거절', async () => {
    const dto = build({});
    const errors = await validate(dto);
    expect(errors[0].property).toBe('closureDate');
  });

  it('closureDate 가 Date 가 아니면 거절', async () => {
    const dto = build({ closureDate: '2026-08-15' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('closureDate');
  });
});
