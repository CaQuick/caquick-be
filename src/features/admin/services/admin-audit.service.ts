import { Inject, Injectable } from '@nestjs/common';

import { toDate } from '@/common/utils/date-parser';
import {
  nextCursorOf,
  normalizeCursorInput,
} from '@/common/utils/id-cursor-page';
import { parseOptionalId } from '@/common/utils/id-parser';
import type { AdminAuditLogListInput } from '@/features/admin/dto/inputs/admin-audit-log-list.input';
import {
  AdminRepository,
  type AdminAuditLogRow,
} from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import type {
  AdminAuditLogOutput,
  AdminCursorConnection,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';

/** 감사 로그 전역 조회. 판매자 화면은 자기 매장·5종만 보지만 관리자는 전부 본다. */
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
  ): Promise<AdminCursorConnection<AdminAuditLogOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: parseOptionalId(input?.cursor),
    });
    const rows = await this.repo.listAuditLogs({
      actorAccountId: parseOptionalId(input?.actorAccountId) ?? undefined,
      storeId: parseOptionalId(input?.storeId) ?? undefined,
      targetType: input?.targetType,
      targetId: parseOptionalId(input?.targetId) ?? undefined,
      action: input?.action,
      fromCreatedAt: toDate(input?.fromCreatedAt),
      toCreatedAt: toDate(input?.toCreatedAt),
      ...normalized,
    });
    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminAuditLogOutput),
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
      // totalCount는 내리지 않는다 — 누적형 로그라 매 조회 COUNT가 부담이다
    };
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
