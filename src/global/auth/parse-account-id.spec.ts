import { BadRequestException } from '@nestjs/common';

import { parseAccountId } from '@/global/auth/parse-account-id';
import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

describe('parseAccountId', () => {
  it('유효한 숫자 accountId를 BigInt로 변환한다', () => {
    expect(parseAccountId({ accountId: '123' } as JwtUser)).toBe(123n);
  });

  it('유효하지 않은 accountId이면 BadRequestException을 던진다', () => {
    expect(() =>
      parseAccountId({ accountId: 'abc' } as unknown as JwtUser),
    ).toThrow(BadRequestException);
  });
});
