import type { AdminUserRow } from '@/features/admin/repositories/admin.repository';
import { activeOrNull } from '@/features/admin/services/admin-mappers.helper';
import type { AdminUserOutput } from '@/features/admin/types/admin-output.type';

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
