import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import { AdminUpsertStoreSettlementAccountInput } from '@/features/order/dto/inputs/admin-upsert-store-settlement-account.input';

const VALID = {
  storeId: '1',
  bankCode: '004',
  accountHolder: '케이크샵',
  accountNumber: '12345678',
  reason: '사유',
};

async function invalidProps(plain: object): Promise<string[]> {
  const errors = await validate(
    plainToInstance(AdminUpsertStoreSettlementAccountInput, plain),
  );
  return errors.map((e) => e.property);
}

// 사유 길이는 DTO(VALIDATION_FAILED)가, 예금주 길이는 서비스(TEXT_TOO_LONG)가 거절한다
describe('AdminUpsertStoreSettlementAccountInput', () => {
  it('사유 500자는 통과하고 501자는 거절한다', async () => {
    expect(
      await invalidProps({ ...VALID, reason: 'r'.repeat(MAX_REASON_LENGTH) }),
    ).toEqual([]);
    expect(
      await invalidProps({
        ...VALID,
        reason: 'r'.repeat(MAX_REASON_LENGTH + 1),
      }),
    ).toEqual(['reason']);
  });

  it('예금주 길이는 DTO에서 거르지 않는다', async () => {
    expect(
      await invalidProps({ ...VALID, accountHolder: '가'.repeat(51) }),
    ).toEqual([]);
  });
});
