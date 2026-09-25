import { Inject, Injectable } from '@nestjs/common';

import type { CursorInput } from '@/common/dto/inputs/cursor.input';
import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { toDateRequired } from '@/common/utils/date-parser';
import { parseId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import type { AuditEntry } from '@/features/audit-log';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  MAX_DAY_OF_WEEK,
  MAX_SPECIAL_CLOSURE_REASON_LENGTH,
  MIN_DAY_OF_WEEK,
} from '@/features/store/constants/store-seller.constants';
import type { SellerUpsertStoreBusinessHourInput } from '@/features/store/dto/inputs/seller-upsert-store-business-hour.input';
import type { SellerUpsertStoreSpecialClosureInput } from '@/features/store/dto/inputs/seller-upsert-store-special-closure.input';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { SellerBaseService } from '@/features/store/services/store-seller-base.service';
import {
  toStoreBusinessHourOutput,
  toStoreSpecialClosureOutput,
} from '@/features/store/services/store-seller-mappers.helper';
import type {
  SellerStoreBusinessHourOutput,
  SellerStoreSpecialClosureOutput,
} from '@/features/store/types/store-seller-output.type';
import type { StoreSpecialClosure } from '@/generated/prisma/client';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';

@Injectable()
export class SellerStoreHoursService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
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
    input?: CursorInput,
  ): Promise<CursorConnection<SellerStoreSpecialClosureOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });

    const [rows, totalCount] = await Promise.all([
      this.repo.listStoreSpecialClosures({
        storeId: ctx.storeId,
        limit: normalized.limit,
        cursor: normalized.cursor,
      }),
      this.repo.countStoreSpecialClosures(ctx.storeId),
    ]);

    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map((row) => toStoreSpecialClosureOutput(row)),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
      totalCount,
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
      throw new DomainException('INVALID_DAY_OF_WEEK');
    }

    const openTime = input.isClosed ? null : this.toTime(input.openTime);
    const closeTime = input.isClosed ? null : this.toTime(input.closeTime);

    if (!input.isClosed && (!openTime || !closeTime)) {
      throw new DomainException('OPEN_CLOSE_TIME_REQUIRED');
    }

    if (openTime && closeTime && openTime >= closeTime) {
      throw new DomainException('CLOSE_BEFORE_OPEN');
    }

    const row = await this.repo.upsertStoreBusinessHour(
      {
        storeId: ctx.storeId,
        dayOfWeek: input.dayOfWeek,
        isClosed: input.isClosed,
        openTime,
        closeTime,
      },
      (created) => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.STORE,
        targetId: ctx.storeId,
        action: AuditActionType.UPDATE,
        afterJson: {
          dayOfWeek: created.day_of_week,
          isClosed: created.is_closed,
        },
      }),
    );
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
      if (!found) throw new DomainException('SPECIAL_CLOSURE_NOT_FOUND');
    }

    const closureDate = toDateRequired(input.closureDate, 'closureDate');
    const reason = cleanNullableText(
      input.reason,
      MAX_SPECIAL_CLOSURE_REASON_LENGTH,
    );

    // 감사 기록은 repository가 같은 트랜잭션에서 남긴다 — 수정·신규 두 경로가 같은 항목을 쓴다
    const auditClosure = (created: StoreSpecialClosure): AuditEntry => ({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: closureId ? AuditActionType.UPDATE : AuditActionType.CREATE,
      afterJson: {
        closureDate: created.closure_date.toISOString(),
        reason: created.reason,
      },
    });
    const row = closureId
      ? await this.repo.updateStoreSpecialClosure(
          closureId,
          { closureDate, reason },
          auditClosure,
        )
      : await this.repo.createStoreSpecialClosure(
          {
            storeId: ctx.storeId,
            closureDate,
            reason,
          },
          auditClosure,
        );
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
    if (!found) throw new DomainException('SPECIAL_CLOSURE_NOT_FOUND');

    await this.repo.softDeleteStoreSpecialClosure(closureId, () => ({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.DELETE,
      beforeJson: {
        closureDate: found.closure_date.toISOString(),
      },
    }));
    return true;
  }
}
