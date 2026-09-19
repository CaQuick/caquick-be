import { activeOrNull } from '@/common/utils/active-or-null';
import type {
  AdminAccountRow,
  AdminUserRow,
} from '@/features/auth/repositories/account-admin.repository';
import type {
  AdminAccountOutput,
  AdminUserOutput,
} from '@/features/auth/types/auth-admin-output.type';

export function toAdminAccountOutput(row: AdminAccountRow): AdminAccountOutput {
  const credential = activeOrNull(row.credential);
  return {
    accountId: row.id.toString(),
    username: credential?.username ?? null,
    email: row.email,
    name: row.name,
    status: row.status,
    mustChangePassword: credential?.must_change_password ?? false,
    lastLoginAt: credential?.last_login_at ?? null,
    createdAt: row.created_at,
  };
}

/** nested relation은 soft-delete 자동 필터 밖이라 deleted_at을 직접 본다. */
export function toAdminUserOutput(row: AdminUserRow): AdminUserOutput {
  const profile = activeOrNull(row.user_profile);
  return {
    accountId: row.id.toString(),
    email: row.email,
    name: row.name,
    status: row.status,
    nickname: profile?.nickname ?? null,
    phoneNumber: profile?.phone_number ?? null,
    onboardingCompleted: profile?.onboarding_completed_at != null,
    identityProviders: row.account_identities
      .filter((i) => i.deleted_at === null)
      .map((i) => i.provider),
    orderCount: row._count.orders,
    reviewCount: row._count.reviews,
    createdAt: row.created_at,
  };
}
