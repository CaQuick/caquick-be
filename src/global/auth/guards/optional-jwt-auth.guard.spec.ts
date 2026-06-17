import { OptionalJwtAuthGuard } from '@/global/auth/guards/optional-jwt-auth.guard';
import type { JwtUser } from '@/global/auth/types/jwt-payload.type';

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();
  const user: JwtUser = { accountId: '1', accountType: 'USER' };

  it('user가 있으면 그대로 반환한다', () => {
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('user가 false면(토큰 없음) undefined를 반환한다', () => {
    expect(guard.handleRequest(null, false)).toBeUndefined();
  });

  it('user가 null이면 undefined를 반환한다', () => {
    expect(guard.handleRequest(null, null)).toBeUndefined();
  });

  it('에러가 있어도 user가 있으면 통과시킨다(에러를 throw하지 않음)', () => {
    expect(guard.handleRequest(new Error('expired'), user)).toBe(user);
  });
});
