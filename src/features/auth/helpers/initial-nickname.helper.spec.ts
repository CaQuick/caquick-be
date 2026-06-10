import { buildInitialNickname } from '@/features/auth/helpers/initial-nickname.helper';

// 앱 nickname 정책(영문/숫자/한글/_) — 생성 결과가 항상 이를 만족해야 한다.
const NICKNAME_REGEX = /^[A-Za-z0-9가-힣_]+$/;

describe('buildInitialNickname', () => {
  it('공백 포함 이름은 공백을 제거하고 accountId suffix 를 붙인다', () => {
    expect(buildInitialNickname(5n, 'John Doe')).toBe('JohnDoe_5');
  });

  it('특수문자는 제거한다', () => {
    expect(buildInitialNickname(7n, 'user@123!')).toBe('user123_7');
  });

  it('한글 이름은 유지한다', () => {
    expect(buildInitialNickname(9n, '김 철수')).toBe('김철수_9');
  });

  it('표시 이름이 비거나 모두 특수문자면 이메일 local part 를 정제해 사용한다', () => {
    expect(buildInitialNickname(3n, '!!!', 'john.doe@example.com')).toBe(
      'johndoe_3',
    );
  });

  it('이름·이메일이 모두 없거나 무효면 user 로 폴백한다', () => {
    expect(buildInitialNickname(11n)).toBe('user_11');
    expect(buildInitialNickname(12n, '   ', '@@@')).toBe('user_12');
  });

  it('VarChar(50) 한도 내로 clamp 하되 accountId suffix 는 보존한다', () => {
    const longName = 'a'.repeat(100);
    const result = buildInitialNickname(123n, longName);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith('_123')).toBe(true);
  });

  it('생성 결과는 항상 nickname 정책(regex)을 만족한다', () => {
    const cases: [bigint, string | undefined, string | undefined][] = [
      [1n, 'John Doe', undefined],
      [2n, 'user@!#$', 'a.b+c@x.com'],
      [3n, '김 철수 ', undefined],
      [4n, undefined, undefined],
    ];
    for (const [id, name, email] of cases) {
      expect(buildInitialNickname(id, name, email)).toMatch(NICKNAME_REGEX);
    }
  });

  it('서로 다른 accountId 는 서로 다른 nickname 을 만든다 (유니크 보장)', () => {
    expect(buildInitialNickname(1n, '철수')).not.toBe(
      buildInitialNickname(2n, '철수'),
    );
  });
});
