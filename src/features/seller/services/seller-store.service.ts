import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType, Prisma } from '@prisma/client';

import { toDate, toDateRequired } from '@/common/utils/date-parser';
import { parseId } from '@/common/utils/id-parser';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  CLOSE_BEFORE_OPEN,
  DAILY_CAPACITY_NOT_FOUND,
  INVALID_DAY_OF_WEEK,
  OPEN_CLOSE_TIME_REQUIRED,
  SPECIAL_CLOSURE_NOT_FOUND,
  STORE_NOT_FOUND,
} from '@/features/seller/constants/seller-error-messages';
import {
  MAX_ADDRESS_CITY_LENGTH,
  MAX_ADDRESS_DISTRICT_LENGTH,
  MAX_ADDRESS_FULL_LENGTH,
  MAX_ADDRESS_NEIGHBORHOOD_LENGTH,
  MAX_BUSINESS_HOURS_TEXT_LENGTH,
  MAX_DAILY_CAPACITY,
  MAX_DAYS_AHEAD,
  MAX_DAY_OF_WEEK,
  MAX_LEAD_TIME_MINUTES,
  MAX_PICKUP_SLOT_INTERVAL_MINUTES,
  MAX_SPECIAL_CLOSURE_REASON_LENGTH,
  MAX_STORE_NAME_LENGTH,
  MAX_STORE_PHONE_LENGTH,
  MAX_URL_LENGTH,
  MIN_DAILY_CAPACITY,
  MIN_DAYS_AHEAD,
  MIN_DAY_OF_WEEK,
  MIN_LEAD_TIME_MINUTES,
  MIN_PICKUP_SLOT_INTERVAL_MINUTES,
} from '@/features/seller/constants/seller.constants';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import type {
  SellerCursorInput,
  SellerDateCursorInput,
  SellerUpdatePickupPolicyInput,
  SellerUpdateStoreBasicInfoInput,
  SellerUpsertStoreBusinessHourInput,
  SellerUpsertStoreDailyCapacityInput,
  SellerUpsertStoreSpecialClosureInput,
} from '@/features/seller/types/seller-input.type';
import type {
  SellerCursorConnection,
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerStoreService extends SellerBaseService {
  constructor(repo: SellerRepository) {
    super(repo);
  }
  async sellerMyStore(accountId: bigint): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const store = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!store) throw new NotFoundException(STORE_NOT_FOUND);
    return this.toStoreOutput(store);
  }

  async sellerStoreBusinessHours(
    accountId: bigint,
  ): Promise<SellerStoreBusinessHourOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const rows = await this.repo.listStoreBusinessHours(ctx.storeId);
    return rows.map((row) => this.toStoreBusinessHourOutput(row));
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
      items: paged.items.map((row) => this.toStoreSpecialClosureOutput(row)),
      nextCursor: paged.nextCursor,
    };
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
      items: paged.items.map((row) => this.toStoreDailyCapacityOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerUpdateStoreBasicInfo(
    accountId: bigint,
    input: SellerUpdateStoreBasicInfoInput,
  ): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!current) throw new NotFoundException(STORE_NOT_FOUND);

    const data = this.buildStoreBasicInfoUpdateData(input);
    const updated = await this.repo.updateStore({
      storeId: ctx.storeId,
      data,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.UPDATE,
      beforeJson: {
        storeName: current.store_name,
        storePhone: current.store_phone,
      },
      afterJson: {
        storeName: updated.store_name,
        storePhone: updated.store_phone,
      },
    });

    return this.toStoreOutput(updated);
  }

  private buildStoreBasicInfoUpdateData(
    input: SellerUpdateStoreBasicInfoInput,
  ): Prisma.StoreUpdateInput {
    return {
      ...(input.storeName !== undefined
        ? {
            store_name: cleanRequiredText(
              input.storeName,
              MAX_STORE_NAME_LENGTH,
            ),
          }
        : {}),
      ...(input.storePhone !== undefined
        ? {
            store_phone: cleanRequiredText(
              input.storePhone,
              MAX_STORE_PHONE_LENGTH,
            ),
          }
        : {}),
      ...(input.addressFull !== undefined
        ? {
            address_full: cleanRequiredText(
              input.addressFull,
              MAX_ADDRESS_FULL_LENGTH,
            ),
          }
        : {}),
      ...(input.addressCity !== undefined
        ? {
            address_city: cleanNullableText(
              input.addressCity,
              MAX_ADDRESS_CITY_LENGTH,
            ),
          }
        : {}),
      ...(input.addressDistrict !== undefined
        ? {
            address_district: cleanNullableText(
              input.addressDistrict,
              MAX_ADDRESS_DISTRICT_LENGTH,
            ),
          }
        : {}),
      ...(input.addressNeighborhood !== undefined
        ? {
            address_neighborhood: cleanNullableText(
              input.addressNeighborhood,
              MAX_ADDRESS_NEIGHBORHOOD_LENGTH,
            ),
          }
        : {}),
      ...(input.latitude !== undefined
        ? { latitude: this.toDecimal(input.latitude) }
        : {}),
      ...(input.longitude !== undefined
        ? { longitude: this.toDecimal(input.longitude) }
        : {}),
      ...(input.mapProvider !== undefined && input.mapProvider !== null
        ? { map_provider: input.mapProvider }
        : {}),
      ...(input.websiteUrl !== undefined
        ? {
            website_url: cleanNullableText(input.websiteUrl, MAX_URL_LENGTH),
          }
        : {}),
      ...(input.businessHoursText !== undefined
        ? {
            business_hours_text: cleanNullableText(
              input.businessHoursText,
              MAX_BUSINESS_HOURS_TEXT_LENGTH,
            ),
          }
        : {}),
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

    await this.repo.createAuditLog({
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

    return this.toStoreBusinessHourOutput(row);
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

    await this.repo.createAuditLog({
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

    return this.toStoreSpecialClosureOutput(row);
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
    await this.repo.createAuditLog({
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

    await this.repo.createAuditLog({
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

    return this.toStoreOutput(updated);
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

    await this.repo.createAuditLog({
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

    return this.toStoreDailyCapacityOutput(row);
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
    await this.repo.createAuditLog({
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

  private toStoreOutput(row: {
    id: bigint;
    seller_account_id: bigint;
    store_name: string;
    store_phone: string;
    address_full: string;
    address_city: string | null;
    address_district: string | null;
    address_neighborhood: string | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    map_provider: 'NAVER' | 'KAKAO' | 'NONE';
    website_url: string | null;
    business_hours_text: string | null;
    pickup_slot_interval_minutes: number;
    min_lead_time_minutes: number;
    max_days_ahead: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }): SellerStoreOutput {
    return {
      id: row.id.toString(),
      sellerAccountId: row.seller_account_id.toString(),
      storeName: row.store_name,
      storePhone: row.store_phone,
      addressFull: row.address_full,
      addressCity: row.address_city,
      addressDistrict: row.address_district,
      addressNeighborhood: row.address_neighborhood,
      latitude: row.latitude?.toString() ?? null,
      longitude: row.longitude?.toString() ?? null,
      mapProvider: row.map_provider,
      websiteUrl: row.website_url,
      businessHoursText: row.business_hours_text,
      pickupSlotIntervalMinutes: row.pickup_slot_interval_minutes,
      minLeadTimeMinutes: row.min_lead_time_minutes,
      maxDaysAhead: row.max_days_ahead,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toStoreBusinessHourOutput(row: {
    id: bigint;
    day_of_week: number;
    is_closed: boolean;
    open_time: Date | null;
    close_time: Date | null;
    created_at: Date;
    updated_at: Date;
  }): SellerStoreBusinessHourOutput {
    return {
      id: row.id.toString(),
      dayOfWeek: row.day_of_week,
      isClosed: row.is_closed,
      openTime: row.open_time,
      closeTime: row.close_time,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toStoreSpecialClosureOutput(row: {
    id: bigint;
    closure_date: Date;
    reason: string | null;
    created_at: Date;
    updated_at: Date;
  }): SellerStoreSpecialClosureOutput {
    return {
      id: row.id.toString(),
      closureDate: row.closure_date,
      reason: row.reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toStoreDailyCapacityOutput(row: {
    id: bigint;
    capacity_date: Date;
    capacity: number;
    created_at: Date;
    updated_at: Date;
  }): SellerStoreDailyCapacityOutput {
    return {
      id: row.id.toString(),
      capacityDate: row.capacity_date,
      capacity: row.capacity,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
