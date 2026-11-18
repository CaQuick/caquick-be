import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerAuditLogListInput } from '@/features/store/dto/inputs/seller-audit-log-list.input';

function build(plain: object): SellerAuditLogListInput {
  return plainToInstance(SellerAuditLogListInput, plain);
}

describe('SellerAuditLogListInput', () => {
  it('빈 입력 허용', async () => {
    const dto = build({});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('targetType 허용 값 통과', async () => {
    const dto = build({ targetType: 'STORE' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('정산 계좌(SETTLEMENT_ACCOUNT)는 받고 관리자 전용 대상(ACCOUNT)은 거절한다', async () => {
    expect(
      await validate(build({ targetType: 'SETTLEMENT_ACCOUNT' })),
    ).toHaveLength(0);
    const errors = await validate(build({ targetType: 'ACCOUNT' }));
    expect(errors[0].property).toBe('targetType');
  });

  it('알 수 없는 targetType 거절', async () => {
    const dto = build({ targetType: 'INVALID' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('targetType');
  });
});
