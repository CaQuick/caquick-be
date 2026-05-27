import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import { toDate, toDateRequired } from '@/common/utils/date-parser';
import { parseId } from '@/common/utils/id-parser';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  DAILY_CAPACITY_NOT_FOUND,
  STORE_NOT_FOUND,
} from '@/features/seller/constants/seller-error-messages';
import {
  MAX_DAILY_CAPACITY,
  MAX_DAYS_AHEAD,
  MAX_LEAD_TIME_MINUTES,
  MAX_PICKUP_SLOT_INTERVAL_MINUTES,
  MIN_DAILY_CAPACITY,
  MIN_DAYS_AHEAD,
  MIN_LEAD_TIME_MINUTES,
  MIN_PICKUP_SLOT_INTERVAL_MINUTES,
} from '@/features/seller/constants/seller.constants';
import type { SellerDateCursorInput } from '@/features/seller/dto/inputs/seller-date-cursor.input';
import type { SellerUpdatePickupPolicyInput } from '@/features/seller/dto/inputs/seller-update-pickup-policy.input';
import type { SellerUpsertStoreDailyCapacityInput } from '@/features/seller/dto/inputs/seller-upsert-store-daily-capacity.input';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import {
  toStoreDailyCapacityOutput,
  toStoreOutput,
} from '@/features/seller/services/seller-store-mappers.helper';
import type { ISellerStorePolicyService } from '@/features/seller/services/seller-store-policy.service.interface';
import type {
  SellerCursorConnection,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
} from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerStorePolicyService
  extends SellerBaseService
  implements ISellerStorePolicyService
{
  constructor(
    repo: SellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerStoreDailyCapacities(
    accountId: bigint,
    input?: SellerDateCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreDailyCapacityOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const rows = await this.repo.listStoreDailyCapacities({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      fromDate: toDate(input?.fromDate),
      toDate: toDate(input?.toDate),
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => toStoreDailyCapacityOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerUpdatePickupPolicy(
    accountId: bigint,
    input: SellerUpdatePickupPolicyInput,
  ): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!current) throw new NotFoundException(STORE_NOT_FOUND);

    this.assertPositiveRange(
      input.pickupSlotIntervalMinutes,
      MIN_PICKUP_SLOT_INTERVAL_MINUTES,
      MAX_PICKUP_SLOT_INTERVAL_MINUTES,
      'pickupSlotIntervalMinutes',
    );
    this.assertPositiveRange(
      input.minLeadTimeMinutes,
      MIN_LEAD_TIME_MINUTES,
      MAX_LEAD_TIME_MINUTES,
      'minLeadTimeMinutes',
    );
    this.assertPositiveRange(
      input.maxDaysAhead,
      MIN_DAYS_AHEAD,
      MAX_DAYS_AHEAD,
      'maxDaysAhead',
    );

    const updated = await this.repo.updateStore({
      storeId: ctx.storeId,
      data: {
        pickup_slot_interval_minutes: input.pickupSlotIntervalMinutes,
        min_lead_time_minutes: input.minLeadTimeMinutes,
        max_days_ahead: input.maxDaysAhead,
      },
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.UPDATE,
      beforeJson: {
        pickupSlotIntervalMinutes: current.pickup_slot_interval_minutes,
        minLeadTimeMinutes: current.min_lead_time_minutes,
        maxDaysAhead: current.max_days_ahead,
      },
      afterJson: {
        pickupSlotIntervalMinutes: updated.pickup_slot_interval_minutes,
        minLeadTimeMinutes: updated.min_lead_time_minutes,
        maxDaysAhead: updated.max_days_ahead,
      },
    });

    return toStoreOutput(updated);
  }

  async sellerUpsertStoreDailyCapacity(
    accountId: bigint,
    input: SellerUpsertStoreDailyCapacityInput,
  ): Promise<SellerStoreDailyCapacityOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const capacityId = input.capacityId ? parseId(input.capacityId) : undefined;

    if (capacityId) {
      const found = await this.repo.findStoreDailyCapacityById(
        capacityId,
        ctx.storeId,
      );
      if (!found) throw new NotFoundException(DAILY_CAPACITY_NOT_FOUND);
    }

    this.assertPositiveRange(
      input.capacity,
      MIN_DAILY_CAPACITY,
      MAX_DAILY_CAPACITY,
      'capacity',
    );

    const capacityDate = toDateRequired(input.capacityDate, 'capacityDate');

    const row = capacityId
      ? await this.repo.updateStoreDailyCapacity(capacityId, {
          capacityDate,
          capacity: input.capacity,
        })
      : await this.repo.createStoreDailyCapacity({
          storeId: ctx.storeId,
          capacityDate,
          capacity: input.capacity,
        });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: capacityId ? AuditActionType.UPDATE : AuditActionType.CREATE,
      afterJson: {
        capacityDate: row.capacity_date.toISOString().slice(0, 10),
        capacity: row.capacity,
      },
    });

    return toStoreDailyCapacityOutput(row);
  }

  async sellerDeleteStoreDailyCapacity(
    accountId: bigint,
    capacityId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const found = await this.repo.findStoreDailyCapacityById(
      capacityId,
      ctx.storeId,
    );
    if (!found) throw new NotFoundException(DAILY_CAPACITY_NOT_FOUND);

    await this.repo.softDeleteStoreDailyCapacity(capacityId);
    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.DELETE,
      beforeJson: {
        capacityDate: found.capacity_date.toISOString().slice(0, 10),
        capacity: found.capacity,
      },
    });
    return true;
  }
}
