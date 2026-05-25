import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpdateOrderStatusInput } from '@/features/seller/dto/inputs/seller-update-order-status.input';

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
