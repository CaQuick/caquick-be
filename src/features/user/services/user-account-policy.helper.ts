import { AccountType } from '@/generated/prisma/client';

/**
 * user 마이페이지 계열(requireActiveUser)과 주문 생성(requireActiveBuyer)이 동일 의미론을 공유한다 —
 * 판정 분기는 여기서만 두고, 실패 사유 → 에러 코드 매핑은 호출부가 각자 유지한다. DI-free 순수 함수만 둔다.
 */

export interface ActiveUserAccountCandidate {
  /** soft-delete extension이 루트 READ에서 걸러주는 쿼리는 생략 가능(생략 시 삭제 검사 통과로 간주). */
  deleted_at?: Date | null;
  account_type: AccountType;
  user_profile: { deleted_at: Date | null } | null;
}

export type ActiveUserAccountFailure =
  'ACCOUNT_NOT_FOUND' | 'ACCOUNT_DELETED' | 'NOT_USER' | 'PROFILE_INACTIVE';

/** 판정 순서: 미존재 → 계정 삭제 → USER 아님 → 프로필 미존재/삭제. */
export function evaluateActiveUserAccount(
  account: ActiveUserAccountCandidate | null,
): ActiveUserAccountFailure | null {
  if (!account) return 'ACCOUNT_NOT_FOUND';
  if (account.deleted_at) return 'ACCOUNT_DELETED';
  if (account.account_type !== AccountType.USER) return 'NOT_USER';
  if (!account.user_profile || account.user_profile.deleted_at) {
    return 'PROFILE_INACTIVE';
  }
  return null;
}
