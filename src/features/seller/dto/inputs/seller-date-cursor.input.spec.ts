import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerDateCursorInput } from '@/features/seller/dto/inputs/seller-date-cursor.input';

function build(plain: object): SellerDateCursorInput {
  return plainToInstance(SellerDateCursorInput, plain);
}

describe('SellerDateCursorInput', () => {
  it('빈 입력 허용', async () => {
    const dto = build({});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('유효 Date 범위 허용', async () => {
    const dto = build({
      fromDate: new Date('2026-01-01'),
      toDate: new Date('2026-12-31'),
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('fromDate 가 Date 가 아니면 거절', async () => {
    const dto = build({ fromDate: '2026-01-01' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('fromDate');
  });

  it('SellerCursorInput 의 limit 검증 상속', async () => {
    const dto = build({ limit: 101 });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('limit');
  });
});
