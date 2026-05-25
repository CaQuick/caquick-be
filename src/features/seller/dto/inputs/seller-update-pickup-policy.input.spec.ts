import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerUpdatePickupPolicyInput } from '@/features/seller/dto/inputs/seller-update-pickup-policy.input';

function build(plain: object): SellerUpdatePickupPolicyInput {
  return plainToInstance(SellerUpdatePickupPolicyInput, plain);
}

describe('SellerUpdatePickupPolicyInput', () => {
  it('정상 입력 통과', async () => {
    const dto = build({
      pickupSlotIntervalMinutes: 30,
      minLeadTimeMinutes: 60,
      maxDaysAhead: 30,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('pickupSlotIntervalMinutes 0 거절', async () => {
    const dto = build({
      pickupSlotIntervalMinutes: 0,
      minLeadTimeMinutes: 60,
      maxDaysAhead: 30,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('pickupSlotIntervalMinutes');
  });

  it('minLeadTimeMinutes 0 통과 (즉시 픽업 허용)', async () => {
    const dto = build({
      pickupSlotIntervalMinutes: 30,
      minLeadTimeMinutes: 0,
      maxDaysAhead: 30,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('maxDaysAhead 0 거절', async () => {
    const dto = build({
      pickupSlotIntervalMinutes: 30,
      minLeadTimeMinutes: 60,
      maxDaysAhead: 0,
    });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('maxDaysAhead');
  });

  it('전체 필드 누락 거절', async () => {
    const dto = build({});
    const errors = await validate(dto);
    expect(errors).toHaveLength(3);
  });
});
