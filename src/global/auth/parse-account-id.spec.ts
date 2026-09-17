import { parseAccountId } from '@/global/auth/parse-account-id';
import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

function user(accountId: unknown): JwtUser {
  return { accountId } as unknown as JwtUser;
}

describe('parseAccountId', () => {
  it('유효한 숫자 accountId를 BigInt로 변환한다', () => {
    expect(parseAccountId(user('123'))).toBe(123n);
  });

  it('큰 숫자도 BigInt로 변환한다', () => {
    expect(parseAccountId(user('9999999999999999'))).toBe(9999999999999999n);
  });

  it('0도 유효하다', () => {
    expect(parseAccountId(user('0'))).toBe(0n);
  });

  it('유효하지 않은 문자열이면 400을 던진다', () => {
    expect(() => parseAccountId(user('abc'))).toThrowDomain(400);
    expect(() => parseAccountId(user('abc'))).toThrowDomain(
      'INVALID_ACCOUNT_ID',
    );
  });

  it('소수점이 포함되면 400을 던진다', () => {
    expect(() => parseAccountId(user('1.5'))).toThrowDomain(400);
  });

  it('빈 문자열이면 400을 던진다', () => {
    expect(() => parseAccountId(user(''))).toThrowDomain(400);
    expect(() => parseAccountId(user('   '))).toThrowDomain(400);
  });

  it('음수이면 400을 던진다', () => {
    expect(() => parseAccountId(user('-1'))).toThrowDomain(400);
  });

  it('undefined이면 400을 던진다', () => {
    expect(() => parseAccountId(user(undefined))).toThrowDomain(400);
  });

  it('null이면 400을 던진다', () => {
    expect(() => parseAccountId(user(null))).toThrowDomain(400);
  });
});
