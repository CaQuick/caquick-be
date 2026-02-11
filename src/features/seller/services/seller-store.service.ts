import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType, Prisma } from '@prisma/client';

import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '../repositories/seller.repository';
import type {
  SellerCursorInput,
  SellerDateCursorInput,
  SellerUpdatePickupPolicyInput,
  SellerUpdateStoreBasicInfoInput,
  SellerUpsertStoreBusinessHourInput,
  SellerUpsertStoreDailyCapacityInput,
  SellerUpsertStoreSpecialClosureInput,
} from '../types/seller-input.type';
import type {
  SellerCursorConnection,
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '../types/seller-output.type';

import { SellerBaseService } from './seller-base.service';

@Injectable()
export class SellerStoreService extends SellerBaseService {
  constructor(repo: SellerRepository) {
    super(repo);
  }
  async sellerMyStore(accountId: bigint): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const store = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!store) throw new NotFoundException('Store not found.');
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
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
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
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
    });

    const rows = await this.repo.listStoreDailyCapacities({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      fromDate: this.toDate(input?.fromDate),
      toDate: this.toDate(input?.toDate),
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
    if (!current) throw new NotFoundException('Store not found.');

    const data: Prisma.StoreUpdateInput = {
      ...(input.storeName !== undefined
        ? { store_name: this.cleanRequiredText(input.storeName, 200) }
        : {}),
      ...(input.storePhone !== undefined
        ? { store_phone: this.cleanRequiredText(input.storePhone, 30) }
        : {}),
      ...(input.addressFull !== undefined
        ? { address_full: this.cleanRequiredText(input.addressFull, 500) }
        : {}),
      ...(input.addressCity !== undefined
        ? { address_city: this.cleanNullableText(input.addressCity, 50) }
        : {}),
      ...(input.addressDistrict !== undefined
        ? {
            address_district: this.cleanNullableText(input.addressDistrict, 80),
          }
        : {}),
      ...(input.addressNeighborhood !== undefined
        ? {
            address_neighborhood: this.cleanNullableText(
              input.addressNeighborhood,
              80,
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
        ? { website_url: this.cleanNullableText(input.websiteUrl, 2048) }
        : {}),
      ...(input.businessHoursText !== undefined
        ? {
            business_hours_text: this.cleanNullableText(
              input.businessHoursText,
              500,
            ),
          }
        : {}),
    };

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

  async sellerUpsertStoreBusinessHour(
    accountId: bigint,
    input: SellerUpsertStoreBusinessHourInput,
  ): Promise<SellerStoreBusinessHourOutput> {
    const ctx = await this.requireSellerContext(accountId);

    if (input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      throw new BadRequestException('dayOfWeek must be 0~6.');
    }

    const openTime = input.isClosed ? null : this.toTime(input.openTime);
    const closeTime = input.isClosed ? null : this.toTime(input.closeTime);

    if (!input.isClosed && (!openTime || !closeTime)) {
      throw new BadRequestException('openTime and closeTime are required.');
    }

    if (openTime && closeTime && openTime >= closeTime) {
      throw new BadRequestException('closeTime must be after openTime.');
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
    const closureId = input.closureId
      ? this.parseId(input.closureId)
      : undefined;

    if (closureId) {
      const found = await this.repo.findStoreSpecialClosureById(
        closureId,
        ctx.storeId,
      );
      if (!found) throw new NotFoundException('Special closure not found.');
    }

    const row = await this.repo.upsertStoreSpecialClosure({
      storeId: ctx.storeId,
      closureId,
      closureDate: this.toDateRequired(input.closureDate, 'closureDate'),
      reason: this.cleanNullableText(input.reason, 200),
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
    if (!found) throw new NotFoundException('Special closure not found.');

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
    if (!current) throw new NotFoundException('Store not found.');

    this.assertPositiveRange(
      input.pickupSlotIntervalMinutes,
      5,
      180,
      'pickupSlotIntervalMinutes',
    );
    this.assertPositiveRange(
      input.minLeadTimeMinutes,
      0,
      7 * 24 * 60,
      'minLeadTimeMinutes',
    );
    this.assertPositiveRange(input.maxDaysAhead, 1, 365, 'maxDaysAhead');

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
    const capacityId = input.capacityId
      ? this.parseId(input.capacityId)
      : undefined;

    if (capacityId) {
      const found = await this.repo.findStoreDailyCapacityById(
        capacityId,
        ctx.storeId,
      );
      if (!found) throw new NotFoundException('Daily capacity not found.');
    }

    this.assertPositiveRange(input.capacity, 1, 5000, 'capacity');

    const row = await this.repo.upsertStoreDailyCapacity({
      storeId: ctx.storeId,
      capacityId,
      capacityDate: this.toDateRequired(input.capacityDate, 'capacityDate'),
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
    if (!found) throw new NotFoundException('Daily capacity not found.');

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
}
