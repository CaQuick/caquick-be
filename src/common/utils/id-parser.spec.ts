import { BadRequestException } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';

describe('id-parser', () => {
  it('유효한 숫자 문자열을 BigInt로 변환한다', () => {
    expect(parseId('123')).toBe(123n);
  });

  it('큰 숫자도 BigInt로 변환한다', () => {
    expect(parseId('9999999999999999')).toBe(9999999999999999n);
  });

  it('0도 유효하다', () => {
    expect(parseId('0')).toBe(0n);
  });

  // Node.js에서 BigInt('')는 0n을 반환함 (throw하지 않음)
  // parseId의 현재 구현은 이를 허용하는 상태
  it('빈 문자열이면 0n을 반환한다 (BigInt 동작)', () => {
    expect(parseId('')).toBe(0n);
  });

  it('유효하지 않은 문자열이면 BadRequestException을 던진다', () => {
    expect(() => parseId('abc')).toThrow(BadRequestException);
    expect(() => parseId('abc')).toThrow('Invalid id.');
  });

  it('소수점이 포함되면 BadRequestException을 던진다', () => {
    expect(() => parseId('1.5')).toThrow(BadRequestException);
  });

  it('공백이 포함되면 BadRequestException을 던진다', () => {
    expect(() => parseId('1 2')).toThrow(BadRequestException);
  });

  it('음수도 BigInt로 변환된다', () => {
    expect(parseId('-1')).toBe(-1n);
  });
});
