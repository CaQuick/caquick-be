import {
  buildNumberIdCursor,
  buildTimestampIdCursor,
  parseIdCursor,
  parseNumberIdCursor,
  parseTimestampIdCursor,
} from '@/common/utils/keyset-cursor';

describe('keyset-cursor', () => {
  it('build → parse 왕복이 값을 보존한다', () => {
    const ts = new Date('2026-08-01T12:34:56.789Z');
    const raw = buildTimestampIdCursor(ts, BigInt(42));

    expect(parseTimestampIdCursor(raw)).toEqual({
      timestamp: ts,
      id: BigInt(42),
    });
  });

  it('형식이 다르면 거부한다', () => {
    for (const raw of ['abc', '123', '1:2:3', '-1:2', '1:-2', '']) {
      expect(() => parseTimestampIdCursor(raw)).toThrowDomain(400);
    }
  });

  it('안전 정수 밖 timestamp(자릿수 폭탄)를 거부한다', () => {
    expect(() => parseTimestampIdCursor(`${'9'.repeat(30)}:1`)).toThrowDomain(
      400,
    );
  });

  it('Date 지원 범위 밖 timestamp를 거부한다', () => {
    expect(() => parseTimestampIdCursor('9000000000000000:1')).toThrowDomain(
      400,
    );
  });

  it('MySQL DATETIME 상한(9999년)을 넘는 timestamp를 거부한다', () => {
    // 연도 10000 — JS Date로는 유효하지만 MySQL DATETIME 범위 밖
    expect(() => parseTimestampIdCursor('253402300800000:1')).toThrowDomain(
      400,
    );
    // 상한 자체는 허용
    expect(
      parseTimestampIdCursor('253402300799999:1').timestamp.getTime(),
    ).toBe(253402300799999);
  });

  it('UNSIGNED BIGINT 상한을 넘는 id를 거부한다', () => {
    expect(() =>
      parseTimestampIdCursor(`1700000000000:${'9'.repeat(30)}`),
    ).toThrowDomain(400);
    // 상한 자체는 허용
    expect(
      parseTimestampIdCursor('1700000000000:18446744073709551615').id,
    ).toBe(18446744073709551615n);
  });

  describe('parseIdCursor', () => {
    it('정상 id는 bigint로 파싱하고 상한 자체는 허용한다', () => {
      expect(parseIdCursor('42')).toBe(42n);
      expect(parseIdCursor('18446744073709551615')).toBe(18446744073709551615n);
    });

    it('형식 불일치·UNSIGNED BIGINT 상한 초과를 거부한다', () => {
      for (const raw of ['abc', '-1', '', '1.5', '9'.repeat(30)]) {
        expect(() => parseIdCursor(raw)).toThrowDomain(400);
      }
    });
  });

  describe('parseNumberIdCursor (좋아요순 <count>:<id>)', () => {
    it('build → parse 왕복이 값을 보존한다', () => {
      expect(parseNumberIdCursor(buildNumberIdCursor(12, 34n))).toEqual({
        value: 12,
        id: 34n,
      });
    });

    it.each([
      ['형식 불일치', 'abc'],
      ['구분자 없음', '12'],
      ['음수', '-1:2'],
      ['자릿수 폭탄(안전 정수 밖)', `${'9'.repeat(30)}:1`],
      ['id UNSIGNED BIGINT 초과', '1:18446744073709551616'],
      ['빈 문자열', ''],
    ])('%s 거부', (_label, raw) => {
      expect(() => parseNumberIdCursor(raw)).toThrowDomain(400);
    });

    it('id 상한 자체는 허용한다', () => {
      expect(parseNumberIdCursor('0:18446744073709551615').id).toBe(
        18446744073709551615n,
      );
    });
  });
});
