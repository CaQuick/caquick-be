import { parseId, parseOptionalId } from '@/common/utils/id-parser';

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

  it('빈 문자열이면 400을 던진다', () => {
    expect(() => parseId('')).toThrowDomain(400);
    expect(() => parseId('   ')).toThrowDomain(400);
  });

  it('UNSIGNED BIGINT 상한(2^64-1)을 넘으면 400을 던진다', () => {
    expect(parseId('18446744073709551615')).toBe(18446744073709551615n);
    expect(() => parseId('18446744073709551616')).toThrowDomain(400);
    expect(() => parseId('9'.repeat(30))).toThrowDomain(400);
  });

  it('음수이면 400을 던진다', () => {
    expect(() => parseId('-1')).toThrowDomain(400);
  });

  it('유효하지 않은 문자열이면 400을 던진다', () => {
    expect(() => parseId('abc')).toThrowDomain(400);
    expect(() => parseId('abc')).toThrowDomain('INVALID_ID');
  });

  it('소수점이 포함되면 400을 던진다', () => {
    expect(() => parseId('1.5')).toThrowDomain(400);
  });

  it('공백이 포함되면 400을 던진다', () => {
    expect(() => parseId('1 2')).toThrowDomain(400);
  });

  describe('parseOptionalId', () => {
    it.each([undefined, null])('%p은 null', (raw) => {
      expect(parseOptionalId(raw)).toBeNull();
    });

    it('값이 있으면 parseId와 같다("0" 포함)', () => {
      expect(parseOptionalId('0')).toBe(0n);
      expect(parseOptionalId(' 42 ')).toBe(42n);
    });

    it('빈 문자열은 값 없음이 아니라 형식 오류다', () => {
      expect(() => parseOptionalId('')).toThrowDomain(400);
      expect(() => parseOptionalId('   ')).toThrowDomain(400);
    });
  });
});
