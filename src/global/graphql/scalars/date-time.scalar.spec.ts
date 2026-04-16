import { Kind } from 'graphql';

import { DateTimeScalar } from '@/global/graphql/scalars/date-time.scalar';

describe('DateTimeScalar', () => {
  const scalar = new DateTimeScalar();

  describe('parseValue', () => {
    it('유효한 ISO 문자열을 Date로 변환한다', () => {
      const date = scalar.parseValue('2026-01-01T00:00:00.000Z');
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('문자열이 아니면 TypeError를 던진다', () => {
      expect(() => scalar.parseValue(123)).toThrow(TypeError);
    });

    it('유효하지 않은 날짜 문자열이면 TypeError를 던진다', () => {
      expect(() => scalar.parseValue('not-a-date')).toThrow(TypeError);
    });
  });

  describe('serialize', () => {
    it('Date를 ISO 문자열로 직렬화한다', () => {
      const date = new Date('2026-06-15T12:00:00.000Z');
      expect(scalar.serialize(date)).toBe('2026-06-15T12:00:00.000Z');
    });

    it('유효한 날짜 문자열은 ISO 형식으로 정규화하여 반환한다', () => {
      expect(scalar.serialize('2026-01-01')).toBe('2026-01-01T00:00:00.000Z');
      expect(scalar.serialize('2026-06-15T12:00:00Z')).toBe(
        '2026-06-15T12:00:00.000Z',
      );
    });

    it('유효하지 않은 날짜 문자열이면 TypeError를 던진다', () => {
      expect(() => scalar.serialize('not-a-date')).toThrow(TypeError);
    });

    it('숫자이면 TypeError를 던진다', () => {
      expect(() => scalar.serialize(123)).toThrow(TypeError);
    });
  });

  describe('parseLiteral', () => {
    it('STRING 리터럴을 Date로 변환한다', () => {
      const result = scalar.parseLiteral({
        kind: Kind.STRING,
        value: '2026-01-01T00:00:00.000Z',
      });
      expect(result).toBeInstanceOf(Date);
    });

    it('STRING이 아닌 리터럴이면 TypeError를 던진다', () => {
      expect(() =>
        scalar.parseLiteral({ kind: Kind.INT, value: '123' }),
      ).toThrow(TypeError);
    });
  });
});
