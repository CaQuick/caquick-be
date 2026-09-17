import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
  toCursorConnection,
} from '@/common/utils/pagination';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import type { SellerAuditLogListInput } from '@/features/seller/dto/inputs/seller-audit-log-list.input';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import { toAuditLogOutput } from '@/features/seller/services/seller-content-mappers.helper';
import type { SellerAuditLogOutput } from '@/features/seller/types/seller-output.type';
import { AuditTargetType } from '@/generated/prisma/client';

@Injectable()
export class SellerAuditService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerAuditLogs(
    accountId: bigint,
    input?: SellerAuditLogListInput,
  ): Promise<CursorConnection<SellerAuditLogOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });

    const scope = {
      sellerAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: input?.targetType
        ? this.toAuditTargetType(input.targetType)
        : undefined,
    };
    const [rows, totalCount] = await Promise.all([
      this.repo.listAuditLogsBySeller({ ...scope, ...normalized }),
      this.repo.countAuditLogsBySeller(scope),
    ]);

    return toCursorConnection(
      sliceIdCursorPage(rows, normalized.limit),
      totalCount,
      toAuditLogOutput,
    );
  }

  private toAuditTargetType(raw: string): AuditTargetType {
    if (raw === 'STORE') return AuditTargetType.STORE;
    if (raw === 'PRODUCT') return AuditTargetType.PRODUCT;
    if (raw === 'ORDER') return AuditTargetType.ORDER;
    if (raw === 'CONVERSATION') return AuditTargetType.CONVERSATION;
    if (raw === 'CHANGE_PASSWORD') return AuditTargetType.CHANGE_PASSWORD;
    throw new DomainException('INVALID_AUDIT_TARGET_TYPE');
  }
}
