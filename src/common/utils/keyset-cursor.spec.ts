import { BadRequestException } from '@nestjs/common';

import {
  buildTimestampIdCursor,
  parseIdCursor,
  parseTimestampIdCursor,
} from '@/common/utils/keyset-cursor';

describe('keyset-cursor', () => {
  const ERR = 'Invalid cursor.';

  it('build → parse 왕복이 값을 보존한다', () => {
    const ts = new Date('2026-08-01T12:34:56.789Z');
    const raw = buildTimestampIdCursor(ts, BigInt(42));

    expect(parseTimestampIdCursor(raw, ERR)).toEqual({
      timestamp: ts,
      id: BigInt(42),
    });
  });

  it('형식이 다르면 거부한다', () => {
    for (const raw of ['abc', '123', '1:2:3', '-1:2', '1:-2', '']) {
      expect(() => parseTimestampIdCursor(raw, ERR)).toThrow(
        BadRequestException,
      );
    }
  });

  it('안전 정수 밖 timestamp(자릿수 폭탄)를 거부한다', () => {
    expect(() => parseTimestampIdCursor(`${'9'.repeat(30)}:1`, ERR)).toThrow(
      BadRequestException,
    );
  });

  it('Date 지원 범위 밖 timestamp를 거부한다', () => {
    expect(() => parseTimestampIdCursor('9000000000000000:1', ERR)).toThrow(
      BadRequestException,
    );
  });

  it('UNSIGNED BIGINT 상한을 넘는 id를 거부한다', () => {
    expect(() =>
      parseTimestampIdCursor(`1700000000000:${'9'.repeat(30)}`, ERR),
    ).toThrow(BadRequestException);
    // 상한 자체는 허용
    expect(
      parseTimestampIdCursor('1700000000000:18446744073709551615', ERR).id,
    ).toBe(18446744073709551615n);
  });

  describe('parseIdCursor', () => {
    it('정상 id는 bigint로 파싱하고 상한 자체는 허용한다', () => {
      expect(parseIdCursor('42', ERR)).toBe(42n);
      expect(parseIdCursor('18446744073709551615', ERR)).toBe(
        18446744073709551615n,
      );
    });

    it('형식 불일치·UNSIGNED BIGINT 상한 초과를 거부한다', () => {
      for (const raw of ['abc', '-1', '', '1.5', '9'.repeat(30)]) {
        expect(() => parseIdCursor(raw, ERR)).toThrow(BadRequestException);
      }
    });
  });
});
