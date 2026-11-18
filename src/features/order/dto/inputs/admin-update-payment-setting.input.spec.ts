import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import { AdminUpdatePaymentSettingInput } from '@/features/order/dto/inputs/admin-update-payment-setting.input';

async function invalidProps(plain: object): Promise<string[]> {
  const errors = await validate(
    plainToInstance(AdminUpdatePaymentSettingInput, plain),
  );
  return errors.map((e) => e.property);
}

// 사유 길이는 DTO(VALIDATION_FAILED)가, 예금주 길이는 서비스(TEXT_TOO_LONG)가 거절한다
describe('AdminUpdatePaymentSettingInput', () => {
  it('사유 500자는 통과하고 501자는 거절한다', async () => {
    expect(
      await invalidProps({ reason: 'r'.repeat(MAX_REASON_LENGTH) }),
    ).toEqual([]);
    expect(
      await invalidProps({ reason: 'r'.repeat(MAX_REASON_LENGTH + 1) }),
    ).toEqual(['reason']);
  });

  it('예금주 길이는 DTO에서 거르지 않는다', async () => {
    expect(
      await invalidProps({
        depositAccountHolder: '가'.repeat(51),
        reason: '사유',
      }),
    ).toEqual([]);
  });
});
