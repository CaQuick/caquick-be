import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AdminOrderListInput } from '@/features/order/dto/inputs/admin-order-list.input';
import { OrderStatus } from '@/generated/prisma/client';

function build(plain: object): AdminOrderListInput {
  return plainToInstance(AdminOrderListInput, plain);
}

describe('AdminOrderListInput', () => {
  // 손으로 적은 목록이면 새 상태(입금 대기·노쇼)가 빠진다 — enum에서 파생해야 통과한다
  it.each(Object.values(OrderStatus))('status %s 허용', async (status) => {
    expect(await validate(build({ status }))).toHaveLength(0);
  });

  it('알 수 없는 status 거절', async () => {
    const errors = await validate(build({ status: 'UNKNOWN' }));
    expect(errors[0].property).toBe('status');
  });

  it.each([true, false, null, undefined])('inProgress %p 허용', async (v) => {
    expect(await validate(build({ inProgress: v }))).toHaveLength(0);
  });

  it('inProgress가 불리언이 아니면 거절', async () => {
    const errors = await validate(build({ inProgress: 'true' }));
    expect(errors[0].property).toBe('inProgress');
  });
});
