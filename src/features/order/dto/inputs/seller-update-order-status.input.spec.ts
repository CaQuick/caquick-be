import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpdateOrderStatusInput } from '@/features/order/dto/inputs/seller-update-order-status.input';
import { OrderStatus } from '@/generated/prisma/client';

function build(plain: object): SellerUpdateOrderStatusInput {
  return plainToInstance(SellerUpdateOrderStatusInput, plain);
}

describe('SellerUpdateOrderStatusInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({ orderId: '1', toStatus: 'CONFIRMED' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('note 포함 통과', async () => {
    const dto = build({
      orderId: '1',
      toStatus: 'CANCELED',
      note: '재료 소진',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  // 형식은 enum 전부 통과시키고 전이 가능 여부는 정책이 거절한다(NO_SHOW 포함)
  it.each(Object.values(OrderStatus))('toStatus %s 허용', async (toStatus) => {
    expect(await validate(build({ orderId: '1', toStatus }))).toHaveLength(0);
  });

  it('알 수 없는 toStatus 거절', async () => {
    const dto = build({ orderId: '1', toStatus: 'UNKNOWN' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('toStatus');
  });

  it('orderId 누락 거절', async () => {
    const dto = build({ toStatus: 'CONFIRMED' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('orderId');
  });
});
