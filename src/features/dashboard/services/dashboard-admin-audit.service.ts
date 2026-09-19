import { Inject, Injectable } from '@nestjs/common';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { toDate } from '@/common/utils/date-parser';
import { parseOptionalId } from '@/common/utils/id-parser';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
  toCursorConnection,
} from '@/common/utils/pagination';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import type { AdminAuditLogListInput } from '@/features/dashboard/dto/inputs/admin-audit-log-list.input';
import type { AdminAuditLogOutput } from '@/features/dashboard/types/dashboard-admin-output.type';
import type { AccountType, AuditLog } from '@/generated/prisma/client';

@Injectable()
export class AdminAuditService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(accounts, auditLogs);
  }

  async adminAuditLogs(
    accountId: bigint,
    input?: AdminAuditLogListInput,
  ): Promise<CursorConnection<AdminAuditLogOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: parseOptionalId(input?.cursor),
    });
    const filter = {
      actorAccountId: parseOptionalId(input?.actorAccountId) ?? undefined,
      storeId: parseOptionalId(input?.storeId) ?? undefined,
      targetType: input?.targetType,
      targetId: parseOptionalId(input?.targetId) ?? undefined,
      action: input?.action,
      fromCreatedAt: toDate(input?.fromCreatedAt),
      toCreatedAt: toDate(input?.toCreatedAt),
    };
    const [rows, totalCount] = await Promise.all([
      this.auditLogs.listAuditLogs({ ...filter, ...normalized }),
      this.auditLogs.countAuditLogs(filter),
    ]);
    // AuditLog는 계정 FK가 없다(계정이 지워져도 기록을 남기기 위해). 행위자 종류는 identity에서 한 번에 붙인다
    const typeById = await this.accounts.findAccountTypesByIds([
      ...new Set(rows.map((r) => r.actor_account_id)),
    ]);
    return toCursorConnection(
      sliceIdCursorPage(rows, normalized.limit),
      totalCount,
      (row) =>
        toAdminAuditLogOutput(
          row,
          typeById.get(row.actor_account_id.toString()) ?? null,
        ),
    );
  }
}

function toAdminAuditLogOutput(
  row: AuditLog,
  actorAccountType: AccountType | null,
): AdminAuditLogOutput {
  return {
    id: row.id.toString(),
    actorAccountId: row.actor_account_id.toString(),
    actorAccountType,
    storeId: row.store_id?.toString() ?? null,
    targetType: row.target_type,
    targetId: row.target_id.toString(),
    action: row.action,
    beforeJson: row.before_json ? JSON.stringify(row.before_json) : null,
    afterJson: row.after_json ? JSON.stringify(row.after_json) : null,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}
