import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { toDate, toDateRequired } from '@/common/utils/date-parser';
import { parseId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import type { AuditEntry } from '@/features/audit-log';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  MAX_DAILY_CAPACITY,
  MAX_DAYS_AHEAD,
  MAX_LEAD_TIME_MINUTES,
  MAX_PICKUP_SLOT_INTERVAL_MINUTES,
  MIN_DAILY_CAPACITY,
  MIN_DAYS_AHEAD,
  MIN_LEAD_TIME_MINUTES,
  MIN_PICKUP_SLOT_INTERVAL_MINUTES,
} from '@/features/store/constants/store-seller.constants';
import type { SellerDateCursorInput } from '@/features/store/dto/inputs/seller-date-cursor.input';
import type { SellerUpdatePickupPolicyInput } from '@/features/store/dto/inputs/seller-update-pickup-policy.input';
import type { SellerUpsertStoreDailyCapacityInput } from '@/features/store/dto/inputs/seller-upsert-store-daily-capacity.input';
import { StoreCapacityRepository } from '@/features/store/repositories/store-capacity.repository';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { toStoreOutput } from '@/features/store/services/store-output-mappers.helper';
import { SellerBaseService } from '@/features/store/services/store-seller-base.service';
import { toStoreDailyCapacityOutput } from '@/features/store/services/store-seller-mappers.helper';
import type {
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
} from '@/features/store/types/store-seller-output.type';
import type { StoreDailyCapacity } from '@/generated/prisma/client';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';

@Injectable()
export class SellerStorePolicyService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly capacities: StoreCapacityRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerStoreDailyCapacities(
    accountId: bigint,
    input?: SellerDateCursorInput,
  ): Promise<CursorConnection<SellerStoreDailyCapacityOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });

    const filters = {
      storeId: ctx.storeId,
      fromDate: toDate(input?.fromDate),
      toDate: toDate(input?.toDate),
    };

    const [rows, totalCount] = await Promise.all([
      this.repo.listStoreDailyCapacities({
        ...filters,
        limit: normalized.limit,
        cursor: normalized.cursor,
      }),
      this.repo.countStoreDailyCapacities(filters),
    ]);

    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map((row) => toStoreDailyCapacityOutput(row)),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
      totalCount,
    };
  }

  async sellerUpdatePickupPolicy(
    accountId: bigint,
    input: SellerUpdatePickupPolicyInput,
  ): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!current) throw new DomainException('STORE_NOT_FOUND');

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

    const updated = await this.repo.updateStore(
      {
        storeId: ctx.storeId,
        data: {
          pickup_slot_interval_minutes: input.pickupSlotIntervalMinutes,
          min_lead_time_minutes: input.minLeadTimeMinutes,
          max_days_ahead: input.maxDaysAhead,
        },
      },
      (created) => ({
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
          pickupSlotIntervalMinutes: created.pickup_slot_interval_minutes,
          minLeadTimeMinutes: created.min_lead_time_minutes,
          maxDaysAhead: created.max_days_ahead,
        },
      }),
    );
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
      if (!found) throw new DomainException('DAILY_CAPACITY_NOT_FOUND');
    }

    this.assertPositiveRange(
      input.capacity,
      MIN_DAILY_CAPACITY,
      MAX_DAILY_CAPACITY,
      'capacity',
    );

    const capacityDate = toDateRequired(input.capacityDate, 'capacityDate');

    // write는 StoreCapacityRepository — 변경 이벤트를 같은 tx에 적재해 order 복제본이 따라온다(D7-a)
    const auditCapacity = (created: StoreDailyCapacity): AuditEntry => ({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: capacityId ? AuditActionType.UPDATE : AuditActionType.CREATE,
      afterJson: {
        capacityDate: created.capacity_date.toISOString().slice(0, 10),
        capacity: created.capacity,
      },
    });
    const row = capacityId
      ? await this.capacities.updateStoreDailyCapacity(
          {
            capacityId,
            capacityDate,
            capacity: input.capacity,
            actorAccountId: ctx.accountId,
          },
          auditCapacity,
        )
      : await this.capacities.upsertStoreDailyCapacity(
          {
            storeId: ctx.storeId,
            capacityDate,
            capacity: input.capacity,
            actorAccountId: ctx.accountId,
          },
          auditCapacity,
        );

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
    if (!found) throw new DomainException('DAILY_CAPACITY_NOT_FOUND');

    await this.capacities.softDeleteStoreDailyCapacity(
      {
        capacityId,
        actorAccountId: ctx.accountId,
      },
      () => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.STORE,
        targetId: ctx.storeId,
        action: AuditActionType.DELETE,
        beforeJson: {
          capacityDate: found.capacity_date.toISOString().slice(0, 10),
          capacity: found.capacity,
        },
      }),
    );
    return true;
  }
}
