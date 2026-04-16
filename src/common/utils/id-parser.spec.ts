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

  it('앞뒤 공백은 trim하여 처리한다', () => {
    expect(parseId('  42  ')).toBe(42n);
  });

  it('빈 문자열이면 BadRequestException을 던진다', () => {
    expect(() => parseId('')).toThrow(BadRequestException);
    expect(() => parseId('   ')).toThrow(BadRequestException);
  });

  it('음수이면 BadRequestException을 던진다', () => {
    expect(() => parseId('-1')).toThrow(BadRequestException);
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
});
