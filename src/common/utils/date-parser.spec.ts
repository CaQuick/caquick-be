import { BadRequestException } from '@nestjs/common';

import { toDate, toDateRequired } from '@/common/utils/date-parser';

describe('date-parser', () => {
  describe('toDate', () => {
    it('유효하지 않은 날짜면 BadRequestException을 던져야 한다', () => {
      expect(() => toDate('invalid')).toThrow(BadRequestException);
    });

    it('null이면 undefined를 반환해야 한다', () => {
      expect(toDate(null)).toBeUndefined();
    });

    it('undefined이면 undefined를 반환해야 한다', () => {
      expect(toDate(undefined)).toBeUndefined();
    });

    it('유효한 날짜 문자열이면 Date를 반환해야 한다', () => {
      const result = toDate('2024-01-01');
      expect(result).toBeInstanceOf(Date);
    });

    it('Date 객체를 그대로 반환해야 한다', () => {
      const date = new Date('2024-01-01');
      expect(toDate(date)).toBe(date);
    });
  });

  describe('toDateRequired', () => {
    it('유효하지 않은 날짜면 BadRequestException을 던져야 한다', () => {
      expect(() => toDateRequired('invalid', 'testField')).toThrow(
        BadRequestException,
      );
    });

    it('유효한 날짜면 Date를 반환해야 한다', () => {
      const result = toDateRequired('2024-01-01', 'testField');
      expect(result).toBeInstanceOf(Date);
    });
  });
});
