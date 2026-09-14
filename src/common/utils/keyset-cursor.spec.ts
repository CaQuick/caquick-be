import { BadRequestException } from '@nestjs/common';

import {
  MAX_UNSIGNED_BIGINT,
  buildCountIdCursor,
  buildTimestampIdCursor,
  parseCountIdCursor,
  parseIdCursor,
  parseTimestampIdCursor,
} from '@/common/utils/keyset-cursor';

describe('keyset-cursor', () => {
  const ERR = 'INVALID_CURSOR';

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

  it('MySQL DATETIME 상한(9999년)을 넘는 timestamp를 거부한다', () => {
    // 연도 10000 — JS Date로는 유효하지만 MySQL DATETIME 범위 밖
    expect(() => parseTimestampIdCursor('253402300800000:1', ERR)).toThrow(
      BadRequestException,
    );
    // 상한 자체는 허용
    expect(
      parseTimestampIdCursor('253402300799999:1', ERR).timestamp.getTime(),
    ).toBe(253402300799999);
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

  /**
   * 좋아요순 목록이 쓰는 "<집계값>:<id>" 커서. 예전엔 product·store 서비스가 각각
   * 사설 파서를 갖고 있었고 둘 다 UNSIGNED BIGINT 상한 검사가 빠져 있었다.
   * 시각 커서와 형식·방어를 공유하도록 합치면서 그 구멍도 닫힌다.
   */
  describe('parseCountIdCursor', () => {
    it('build → parse 왕복이 값을 보존한다', () => {
      const raw = buildCountIdCursor(42, 7n);
      expect(raw).toBe('42:7');
      expect(parseCountIdCursor(raw, ERR)).toEqual({ count: 42, id: 7n });
    });

    it('집계값 0도 유효하다', () => {
      expect(parseCountIdCursor('0:1', ERR)).toEqual({ count: 0, id: 1n });
    });

    it.each([
      { label: '형식 불일치', raw: 'abc' },
      { label: '구분자 없음', raw: '42' },
      { label: '음수', raw: '-1:2' },
      { label: '소수', raw: '1.5:2' },
      { label: '빈 문자열', raw: '' },
      { label: '자릿수 폭탄(안전 정수 밖)', raw: `${'9'.repeat(309)}:1` },
      {
        label: 'UNSIGNED BIGINT 상한 초과 id',
        raw: `1:${(MAX_UNSIGNED_BIGINT + 1n).toString()}`,
      },
    ])('$label 은 거부한다', ({ raw }) => {
      expect(() => parseCountIdCursor(raw, ERR)).toThrow();
    });

    it('UNSIGNED BIGINT 상한 자체는 허용한다', () => {
      const raw = buildCountIdCursor(1, MAX_UNSIGNED_BIGINT);
      expect(parseCountIdCursor(raw, ERR).id).toBe(MAX_UNSIGNED_BIGINT);
    });
  });
});
