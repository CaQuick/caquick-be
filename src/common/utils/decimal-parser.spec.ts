import {
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  parseDecimalOrNull,
} from '@/common/utils/decimal-parser';

describe('parseDecimalOrNull', () => {
  it.each([undefined, null, '', '   '])('값 없음(%p)은 null', (raw) => {
    expect(parseDecimalOrNull(raw)).toBeNull();
  });

  it('숫자 문자열은 Decimal로, 앞뒤 공백은 무시한다', () => {
    expect(parseDecimalOrNull(' 37.5012 ')?.toString()).toBe('37.5012');
    expect(parseDecimalOrNull('-127.0396')?.toString()).toBe('-127.0396');
  });

  it.each(['abc', '12.3.4', '1e', 'NaN?'])(
    '숫자가 아니면(%s) INVALID_DECIMAL_VALUE',
    (raw) => {
      expect(() => parseDecimalOrNull(raw)).toThrowDomain(
        'INVALID_DECIMAL_VALUE',
      );
    },
  );

  // Prisma.Decimal은 받아들이지만 DECIMAL 컬럼은 거부하는 값 전수
  it.each(['NaN', 'Infinity', '-Infinity'])(
    '유한하지 않은 값(%s)은 거절한다',
    (raw) => {
      expect(() => parseDecimalOrNull(raw)).toThrowDomain(400);
    },
  );

  it('range를 주면 양끝 포함으로 허용하고 밖이면 거절한다', () => {
    expect(parseDecimalOrNull('90', LATITUDE_RANGE)?.toString()).toBe('90');
    expect(parseDecimalOrNull('-180', LONGITUDE_RANGE)?.toString()).toBe(
      '-180',
    );
    expect(() => parseDecimalOrNull('90.0001', LATITUDE_RANGE)).toThrowDomain(
      400,
    );
    expect(() => parseDecimalOrNull('-181', LONGITUDE_RANGE)).toThrowDomain(
      400,
    );
  });
});
