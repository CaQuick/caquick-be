import {
  formatValidationError,
  isValidationErrorLike,
} from '@/common/utils/validation';

describe('validation', () => {
  describe('isValidationErrorLike', () => {
    it('property + constraints가 있으면 true', () => {
      expect(
        isValidationErrorLike({
          property: 'email',
          constraints: { isEmail: 'must be email' },
        }),
      ).toBe(true);
    });

    it('property만 있어도 true (constraints는 optional)', () => {
      expect(isValidationErrorLike({ property: 'name' })).toBe(true);
    });

    it('property가 없으면 false', () => {
      expect(isValidationErrorLike({ constraints: {} })).toBe(false);
    });

    it('property가 문자열이 아니면 false', () => {
      expect(isValidationErrorLike({ property: 123 })).toBe(false);
    });

    it('constraints가 문자열 레코드가 아니면 false', () => {
      expect(
        isValidationErrorLike({ property: 'a', constraints: { k: 123 } }),
      ).toBe(false);
    });

    it('null이면 false', () => {
      expect(isValidationErrorLike(null)).toBe(false);
    });

    it('문자열이면 false', () => {
      expect(isValidationErrorLike('str')).toBe(false);
    });
  });

  describe('formatValidationError', () => {
    it('constraints가 있으면 그대로 반환한다', () => {
      expect(
        formatValidationError({
          property: 'email',
          constraints: { isEmail: 'err' },
        }),
      ).toEqual({ property: 'email', constraints: { isEmail: 'err' } });
    });

    it('constraints가 없으면 빈 객체로 채운다', () => {
      expect(formatValidationError({ property: 'name' })).toEqual({
        property: 'name',
        constraints: {},
      });
    });
  });
});
