import { isRecord, isStringRecord } from '@/common/utils/type-guards';

describe('type-guards', () => {
  describe('isRecord', () => {
    it('일반 객체이면 true', () => {
      expect(isRecord({ a: 1 })).toBe(true);
    });

    it('빈 객체이면 true', () => {
      expect(isRecord({})).toBe(true);
    });

    it('배열이면 true (typeof === object)', () => {
      expect(isRecord([])).toBe(true);
    });

    it('null이면 false', () => {
      expect(isRecord(null)).toBe(false);
    });

    it('undefined이면 false', () => {
      expect(isRecord(undefined)).toBe(false);
    });

    it('문자열이면 false', () => {
      expect(isRecord('str')).toBe(false);
    });

    it('숫자이면 false', () => {
      expect(isRecord(42)).toBe(false);
    });
  });

  describe('isStringRecord', () => {
    it('모든 값이 문자열이면 true', () => {
      expect(isStringRecord({ a: 'x', b: 'y' })).toBe(true);
    });

    it('빈 객체이면 true', () => {
      expect(isStringRecord({})).toBe(true);
    });

    it('숫자 값이 있으면 false', () => {
      expect(isStringRecord({ a: 'x', b: 1 })).toBe(false);
    });

    it('null이면 false', () => {
      expect(isStringRecord(null)).toBe(false);
    });
  });
});
