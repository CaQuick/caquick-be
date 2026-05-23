import 'reflect-metadata';

import { OrderStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MyOrdersInput } from '@/features/user/dto/inputs/my-orders.input';

function build(plain: object): MyOrdersInput {
  return plainToInstance(MyOrdersInput, plain);
}

describe('MyOrdersInput', () => {
  it('statuses 누락 허용', async () => {
    const dto = build({ offset: 0, limit: 20 });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('유효한 OrderStatus 배열 허용', async () => {
    const dto = build({
      statuses: [OrderStatus.SUBMITTED, OrderStatus.CONFIRMED],
      offset: 0,
      limit: 20,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('statuses 가 배열이 아니면 거절', async () => {
    const dto = build({
      statuses: OrderStatus.SUBMITTED as unknown as OrderStatus[],
      offset: 0,
      limit: 20,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].property).toBe('statuses');
  });

  it('알 수 없는 OrderStatus 값 거절', async () => {
    const dto = build({
      statuses: ['UNKNOWN_STATUS'],
      offset: 0,
      limit: 20,
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('statuses');
  });

  it('상속된 페이지네이션 검증도 적용 (offset < 0)', async () => {
    const dto = build({ offset: -1, limit: 20 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('offset');
  });
});
