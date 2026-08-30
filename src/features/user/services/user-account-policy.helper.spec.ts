import { evaluateActiveUserAccount } from '@/features/user/services/user-account-policy.helper';

describe('evaluateActiveUserAccount', () => {
  const activeProfile = { deleted_at: null };

  it('활성 USER 계정 + 활성 프로필은 통과한다', () => {
    expect(
      evaluateActiveUserAccount({
        deleted_at: null,
        account_type: 'USER',
        user_profile: activeProfile,
      }),
    ).toBeNull();
  });

  it('계정 미존재는 ACCOUNT_NOT_FOUND', () => {
    expect(evaluateActiveUserAccount(null)).toBe('ACCOUNT_NOT_FOUND');
  });

  it('soft-delete된 계정은 ACCOUNT_DELETED', () => {
    expect(
      evaluateActiveUserAccount({
        deleted_at: new Date(),
        account_type: 'USER',
        user_profile: activeProfile,
      }),
    ).toBe('ACCOUNT_DELETED');
  });

  it('deleted_at 미선택 쿼리(soft-delete extension이 걸러준 경우)는 삭제 검사를 통과한다', () => {
    expect(
      evaluateActiveUserAccount({
        account_type: 'USER',
        user_profile: activeProfile,
      }),
    ).toBeNull();
  });

  it('SELLER/ADMIN 계정은 NOT_USER', () => {
    expect(
      evaluateActiveUserAccount({
        deleted_at: null,
        account_type: 'SELLER',
        user_profile: activeProfile,
      }),
    ).toBe('NOT_USER');
    expect(
      evaluateActiveUserAccount({
        deleted_at: null,
        account_type: 'ADMIN',
        user_profile: activeProfile,
      }),
    ).toBe('NOT_USER');
  });

  it('프로필 미존재·soft-delete는 PROFILE_INACTIVE', () => {
    expect(
      evaluateActiveUserAccount({
        deleted_at: null,
        account_type: 'USER',
        user_profile: null,
      }),
    ).toBe('PROFILE_INACTIVE');
    expect(
      evaluateActiveUserAccount({
        deleted_at: null,
        account_type: 'USER',
        user_profile: { deleted_at: new Date() },
      }),
    ).toBe('PROFILE_INACTIVE');
  });
});
