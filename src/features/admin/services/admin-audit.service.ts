import { Inject, Injectable } from '@nestjs/common';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { toDate } from '@/common/utils/date-parser';
import { parseOptionalId } from '@/common/utils/id-parser';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
  toCursorConnection,
} from '@/common/utils/pagination';
import type { AdminAuditLogListInput } from '@/features/admin/dto/inputs/admin-audit-log-list.input';
import {
  AdminRepository,
  type AdminAuditLogRow,
} from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import type { AdminAuditLogOutput } from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';

@Injectable()
export class AdminAuditService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
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
      this.repo.listAuditLogs({ ...filter, ...normalized }),
      this.repo.countAuditLogs(filter),
    ]);
    return toCursorConnection(
      sliceIdCursorPage(rows, normalized.limit),
      totalCount,
      toAdminAuditLogOutput,
    );
  }
}

function toAdminAuditLogOutput(row: AdminAuditLogRow): AdminAuditLogOutput {
  return {
    id: row.id.toString(),
    actorAccountId: row.actor_account_id.toString(),
    actorAccountType: row.actor?.account_type ?? null,
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
