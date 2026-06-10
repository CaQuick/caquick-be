import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpsertStoreDailyCapacityInput } from '@/features/seller/dto/inputs/seller-upsert-store-daily-capacity.input';

function build(plain: object): SellerUpsertStoreDailyCapacityInput {
  return plainToInstance(SellerUpsertStoreDailyCapacityInput, plain);
}

describe('SellerUpsertStoreDailyCapacityInput', () => {
  it('필수만 통과', async () => {
    const dto = build({
      capacityDate: new Date('2026-08-15'),
      capacity: 50,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('capacityId 포함 통과 (수정)', async () => {
    const dto = build({
      capacityId: '1',
      capacityDate: new Date('2026-08-15'),
      capacity: 20,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('capacity 음수 거절', async () => {
    const dto = build({
      capacityDate: new Date('2026-08-15'),
      capacity: -1,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('capacity');
  });

  it('capacity 0 통과 (해당일 비활성)', async () => {
    const dto = build({
      capacityDate: new Date('2026-08-15'),
      capacity: 0,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('capacityDate 누락 거절', async () => {
    const dto = build({ capacity: 10 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('capacityDate');
  });
});
