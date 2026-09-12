import { BadRequestException } from '@nestjs/common';

import { parseDecimalOrNull } from '@/common/utils/decimal-parser';

describe('parseDecimalOrNull', () => {
  it.each([undefined, null, '', '   '])('값 없음(%p)은 null', (raw) => {
    expect(parseDecimalOrNull(raw, 'bad')).toBeNull();
  });

  it('숫자 문자열은 Decimal로, 앞뒤 공백은 무시한다', () => {
    expect(parseDecimalOrNull(' 37.5012 ', 'bad')?.toString()).toBe('37.5012');
    expect(parseDecimalOrNull('-127.0396', 'bad')?.toString()).toBe(
      '-127.0396',
    );
  });

  it.each(['abc', '12.3.4', '1e', 'NaN?'])(
    '숫자가 아니면(%s) 호출부 메시지로 BadRequestException',
    (raw) => {
      expect(() => parseDecimalOrNull(raw, 'Invalid decimal value.')).toThrow(
        new BadRequestException('Invalid decimal value.'),
      );
    },
  );
});
