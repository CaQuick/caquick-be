import type { AdminAccountRow } from '@/features/admin/repositories/admin.repository';
import type { AdminAccountOutput } from '@/features/admin/types/admin-output.type';

/** 순수 매퍼(DI 없음). */
export function toAdminAccountOutput(row: AdminAccountRow): AdminAccountOutput {
  return {
    accountId: row.id.toString(),
    username: row.credential?.username ?? null,
    email: row.email,
    name: row.name,
    status: row.status,
    mustChangePassword: row.credential?.must_change_password ?? false,
    lastLoginAt: row.credential?.last_login_at ?? null,
    createdAt: row.created_at,
  };
}
