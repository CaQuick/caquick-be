import type { AdminAccountRow } from '@/features/admin/repositories/admin.repository';
import type { AdminAccountOutput } from '@/features/admin/types/admin-output.type';

/** 순수 매퍼(DI 없음). */
export function toAdminAccountOutput(row: AdminAccountRow): AdminAccountOutput {
  // nested relation은 soft-delete 자동 필터 밖 — 삭제된 자격증명은 없는 것으로 본다
  const credential =
    row.credential && row.credential.deleted_at === null
      ? row.credential
      : null;
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
