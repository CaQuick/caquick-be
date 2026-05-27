import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AuditTargetType } from '@prisma/client';

import { parseId } from '@/common/utils/id-parser';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { INVALID_AUDIT_TARGET_TYPE } from '@/features/seller/constants/seller-error-messages';
import type { SellerAuditLogListInput } from '@/features/seller/dto/inputs/seller-audit-log-list.input';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';
import type { ISellerAuditService } from '@/features/seller/services/seller-audit.service.interface';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import { toAuditLogOutput } from '@/features/seller/services/seller-content-mappers.helper';
import type {
  SellerAuditLogOutput,
  SellerCursorConnection,
} from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerAuditService
  extends SellerBaseService
  implements ISellerAuditService
{
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
  ): Promise<SellerCursorConnection<SellerAuditLogOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const rows = await this.repo.listAuditLogsBySeller({
      sellerAccountId: ctx.accountId,
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      targetType: input?.targetType
        ? this.toAuditTargetType(input.targetType)
        : undefined,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => toAuditLogOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  private toAuditTargetType(raw: string): AuditTargetType {
    if (raw === 'STORE') return AuditTargetType.STORE;
    if (raw === 'PRODUCT') return AuditTargetType.PRODUCT;
    if (raw === 'ORDER') return AuditTargetType.ORDER;
    if (raw === 'CONVERSATION') return AuditTargetType.CONVERSATION;
    if (raw === 'CHANGE_PASSWORD') return AuditTargetType.CHANGE_PASSWORD;
    throw new BadRequestException(INVALID_AUDIT_TARGET_TYPE);
  }
}
