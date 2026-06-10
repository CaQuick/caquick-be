import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerOrderListInput } from '@/features/seller/dto/inputs/seller-order-list.input';

function build(plain: object): SellerOrderListInput {
  return plainToInstance(SellerOrderListInput, plain);
}

describe('SellerOrderListInput', () => {
  it('빈 입력 허용', async () => {
    const dto = build({});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('status + Date 필터 허용', async () => {
    const dto = build({
      status: 'CONFIRMED',
      fromCreatedAt: new Date('2026-01-01'),
      toCreatedAt: new Date('2026-12-31'),
      search: 'gildong',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('알 수 없는 status 거절', async () => {
    const dto = build({ status: 'UNKNOWN' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('status');
  });

  it('fromCreatedAt 가 Date 가 아니면 거절', async () => {
    const dto = build({ fromCreatedAt: '2026-01-01' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('fromCreatedAt');
  });
});
