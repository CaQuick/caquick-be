import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import { toDateRequired } from '@/common/utils/date-parser';
import { parseId } from '@/common/utils/id-parser';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  CLOSE_BEFORE_OPEN,
  INVALID_DAY_OF_WEEK,
  OPEN_CLOSE_TIME_REQUIRED,
  SPECIAL_CLOSURE_NOT_FOUND,
} from '@/features/seller/constants/seller-error-messages';
import {
  MAX_DAY_OF_WEEK,
  MAX_SPECIAL_CLOSURE_REASON_LENGTH,
  MIN_DAY_OF_WEEK,
} from '@/features/seller/constants/seller.constants';
import type { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';
import type { SellerUpsertStoreBusinessHourInput } from '@/features/seller/dto/inputs/seller-upsert-store-business-hour.input';
import type { SellerUpsertStoreSpecialClosureInput } from '@/features/seller/dto/inputs/seller-upsert-store-special-closure.input';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import type { ISellerStoreHoursService } from '@/features/seller/services/seller-store-hours.service.interface';
import {
  toStoreBusinessHourOutput,
  toStoreSpecialClosureOutput,
} from '@/features/seller/services/seller-store-mappers.helper';
import type {
  SellerCursorConnection,
  SellerStoreBusinessHourOutput,
  SellerStoreSpecialClosureOutput,
} from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerStoreHoursService
  extends SellerBaseService
  implements ISellerStoreHoursService
{
  constructor(
    repo: SellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerStoreBusinessHours(
    accountId: bigint,
  ): Promise<SellerStoreBusinessHourOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const rows = await this.repo.listStoreBusinessHours(ctx.storeId);
    return rows.map((row) => toStoreBusinessHourOutput(row));
  }

  async sellerStoreSpecialClosures(
    accountId: bigint,
    input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreSpecialClosureOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const rows = await this.repo.listStoreSpecialClosures({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => toStoreSpecialClosureOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerUpsertStoreBusinessHour(
    accountId: bigint,
    input: SellerUpsertStoreBusinessHourInput,
  ): Promise<SellerStoreBusinessHourOutput> {
    const ctx = await this.requireSellerContext(accountId);

    if (
      input.dayOfWeek < MIN_DAY_OF_WEEK ||
      input.dayOfWeek > MAX_DAY_OF_WEEK
    ) {
      throw new BadRequestException(INVALID_DAY_OF_WEEK);
    }

    const openTime = input.isClosed ? null : this.toTime(input.openTime);
    const closeTime = input.isClosed ? null : this.toTime(input.closeTime);

    if (!input.isClosed && (!openTime || !closeTime)) {
      throw new BadRequestException(OPEN_CLOSE_TIME_REQUIRED);
    }

    if (openTime && closeTime && openTime >= closeTime) {
      throw new BadRequestException(CLOSE_BEFORE_OPEN);
    }

    const row = await this.repo.upsertStoreBusinessHour({
      storeId: ctx.storeId,
      dayOfWeek: input.dayOfWeek,
      isClosed: input.isClosed,
      openTime,
      closeTime,
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.UPDATE,
      afterJson: {
        dayOfWeek: row.day_of_week,
        isClosed: row.is_closed,
      },
    });

    return toStoreBusinessHourOutput(row);
  }

  async sellerUpsertStoreSpecialClosure(
    accountId: bigint,
    input: SellerUpsertStoreSpecialClosureInput,
  ): Promise<SellerStoreSpecialClosureOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const closureId = input.closureId ? parseId(input.closureId) : undefined;

    if (closureId) {
      const found = await this.repo.findStoreSpecialClosureById(
        closureId,
        ctx.storeId,
      );
      if (!found) throw new NotFoundException(SPECIAL_CLOSURE_NOT_FOUND);
    }

    const closureDate = toDateRequired(input.closureDate, 'closureDate');
    const reason = cleanNullableText(
      input.reason,
      MAX_SPECIAL_CLOSURE_REASON_LENGTH,
    );

    const row = closureId
      ? await this.repo.updateStoreSpecialClosure(closureId, {
          closureDate,
          reason,
        })
      : await this.repo.createStoreSpecialClosure({
          storeId: ctx.storeId,
          closureDate,
          reason,
        });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: closureId ? AuditActionType.UPDATE : AuditActionType.CREATE,
      afterJson: {
        closureDate: row.closure_date.toISOString(),
        reason: row.reason,
      },
    });

    return toStoreSpecialClosureOutput(row);
  }

  async sellerDeleteStoreSpecialClosure(
    accountId: bigint,
    closureId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const found = await this.repo.findStoreSpecialClosureById(
      closureId,
      ctx.storeId,
    );
    if (!found) throw new NotFoundException(SPECIAL_CLOSURE_NOT_FOUND);

    await this.repo.softDeleteStoreSpecialClosure(closureId);
    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.DELETE,
      beforeJson: {
        closureDate: found.closure_date.toISOString(),
      },
    });

    return true;
  }
}
