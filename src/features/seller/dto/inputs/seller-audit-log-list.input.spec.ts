import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SellerAuditLogListInput } from '@/features/seller/dto/inputs/seller-audit-log-list.input';

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

  it('알 수 없는 targetType 거절', async () => {
    const dto = build({ targetType: 'INVALID' });
    const errors = await validate(dto);
    expect(errors[0].property).toBe('targetType');
  });
});
