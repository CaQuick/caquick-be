import { BadRequestException } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';

describe('id-parser', () => {
  it('유효한 숫자 문자열을 BigInt로 변환한다', () => {
    expect(parseId('123')).toBe(123n);
  });

  it('큰 숫자도 BigInt로 변환한다', () => {
    expect(parseId('9999999999999999')).toBe(9999999999999999n);
  });

  it('유효하지 않은 문자열이면 BadRequestException을 던진다', () => {
    expect(() => parseId('abc')).toThrow(BadRequestException);
  });

  it('빈 문자열이면 BigInt(0n)을 반환한다', () => {
    // BigInt('')는 0n을 반환 (JavaScript 동작)
    expect(parseId('')).toBe(0n);
  });

  it('소수점이 포함되면 BadRequestException을 던진다', () => {
    expect(() => parseId('1.5')).toThrow(BadRequestException);
  });
});
