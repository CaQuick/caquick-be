import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerOrderListInput } from '@/features/order/dto/inputs/seller-order-list.input';
import { OrderStatus } from '@/generated/prisma/client';

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

  // 손으로 적은 목록이면 새 상태(입금 대기·노쇼)가 빠진다 — enum에서 파생해야 통과한다
  it.each(Object.values(OrderStatus))('status %s 허용', async (status) => {
    expect(await validate(build({ status }))).toHaveLength(0);
  });

  it('buyerAccountId는 문자열만 받는다', async () => {
    expect(await validate(build({ buyerAccountId: '7' }))).toHaveLength(0);
    const errors = await validate(build({ buyerAccountId: 7 }));
    expect(errors[0].property).toBe('buyerAccountId');
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
