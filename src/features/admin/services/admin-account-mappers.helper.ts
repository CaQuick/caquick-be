import type { AdminAccountRow } from '@/features/admin/repositories/admin.repository';
import { activeOrNull } from '@/features/admin/services/admin-mappers.helper';
import type { AdminAccountOutput } from '@/features/admin/types/admin-output.type';

/** 순수 매퍼(DI 없음). */
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
