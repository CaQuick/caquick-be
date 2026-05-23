import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpsertStoreBusinessHourInput } from '@/features/seller/dto/inputs/seller-upsert-store-business-hour.input';

function build(plain: object): SellerUpsertStoreBusinessHourInput {
  return plainToInstance(SellerUpsertStoreBusinessHourInput, plain);
}

describe('SellerUpsertStoreBusinessHourInput', () => {
  it('영업일 + 시간 통과', async () => {
    const dto = build({
      dayOfWeek: 1,
      isClosed: false,
      openTime: new Date('2026-05-24T09:00:00Z'),
      closeTime: new Date('2026-05-24T21:00:00Z'),
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('휴무일 (시간 생략) 통과', async () => {
    const dto = build({ dayOfWeek: 0, isClosed: true });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('dayOfWeek 0 미만 거절', async () => {
    const dto = build({ dayOfWeek: -1, isClosed: false });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('dayOfWeek');
  });

  it('dayOfWeek 7 거절', async () => {
    const dto = build({ dayOfWeek: 7, isClosed: false });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('dayOfWeek');
  });

  it('dayOfWeek 누락 거절', async () => {
    const dto = build({ isClosed: false });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('dayOfWeek');
  });

  it('isClosed 누락 거절', async () => {
    const dto = build({ dayOfWeek: 1 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('isClosed');
  });

  it('openTime 이 Date 가 아니면 거절', async () => {
    const dto = build({
      dayOfWeek: 1,
      isClosed: false,
      openTime: '09:00',
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('openTime');
  });
});
