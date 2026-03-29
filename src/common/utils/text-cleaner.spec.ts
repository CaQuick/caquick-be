import { BadRequestException } from '@nestjs/common';

import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';

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

    it('정확히 maxLength와 같은 길이면 통과해야 한다', () => {
      expect(cleanRequiredText('12345', 5)).toBe('12345');
    });

    it('maxLength를 1만큼 초과하면 BadRequestException을 던져야 한다', () => {
      expect(() => cleanRequiredText('123456', 5)).toThrow(BadRequestException);
    });

    it('앞뒤 공백을 제거한 결과를 반환해야 한다', () => {
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

    it('공백만 있으면 null을 반환해야 한다', () => {
      expect(cleanNullableText('   ', 100)).toBeNull();
    });

    it('최대 길이를 초과하면 BadRequestException을 던져야 한다', () => {
      expect(() => cleanNullableText('abcdef', 5)).toThrow(BadRequestException);
    });

    it('유효한 텍스트를 트림하여 반환해야 한다', () => {
      expect(cleanNullableText('  hello  ', 100)).toBe('hello');
    });

    it('탭/개행/캐리지리턴만 있으면 null을 반환해야 한다', () => {
      expect(cleanNullableText('\t\n\r', 100)).toBeNull();
    });
  });
});
