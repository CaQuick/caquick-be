import { BadRequestException } from '@nestjs/common';

import { cleanNullableText, cleanRequiredText } from './text-cleaner';

describe('text-cleaner', () => {
  describe('cleanRequiredText', () => {
    it('빈 문자열이면 BadRequestException을 던져야 한다', () => {
      expect(() => cleanRequiredText('', 100)).toThrow(BadRequestException);
    });

    it('공백만 있으면 BadRequestException을 던져야 한다', () => {
      expect(() => cleanRequiredText('   ', 100)).toThrow(BadRequestException);
    });

    it('최대 길이를 초과하면 BadRequestException을 던져야 한다', () => {
      expect(() => cleanRequiredText('abcdef', 5)).toThrow(BadRequestException);
    });

    it('유효한 텍스트를 트림하여 반환해야 한다', () => {
      expect(cleanRequiredText('  hello  ', 100)).toBe('hello');
    });
  });

  describe('cleanNullableText', () => {
    it('null이면 null을 반환해야 한다', () => {
      expect(cleanNullableText(null, 100)).toBeNull();
    });

    it('undefined이면 null을 반환해야 한다', () => {
      expect(cleanNullableText(undefined, 100)).toBeNull();
    });

    it('빈 문자열이면 null을 반환해야 한다', () => {
      expect(cleanNullableText('', 100)).toBeNull();
    });

    it('최대 길이를 초과하면 BadRequestException을 던져야 한다', () => {
      expect(() => cleanNullableText('abcdef', 5)).toThrow(BadRequestException);
    });

    it('유효한 텍스트를 트림하여 반환해야 한다', () => {
      expect(cleanNullableText('  hello  ', 100)).toBe('hello');
    });
  });
});
