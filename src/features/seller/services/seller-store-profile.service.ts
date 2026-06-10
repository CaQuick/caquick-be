import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditActionType, AuditTargetType, Prisma } from '@prisma/client';

import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { STORE_NOT_FOUND } from '@/features/seller/constants/seller-error-messages';
import {
  MAX_ADDRESS_CITY_LENGTH,
  MAX_ADDRESS_DISTRICT_LENGTH,
  MAX_ADDRESS_FULL_LENGTH,
  MAX_ADDRESS_NEIGHBORHOOD_LENGTH,
  MAX_BUSINESS_HOURS_TEXT_LENGTH,
  MAX_STORE_NAME_LENGTH,
  MAX_STORE_PHONE_LENGTH,
  MAX_URL_LENGTH,
} from '@/features/seller/constants/seller.constants';
import type { SellerUpdateStoreBasicInfoInput } from '@/features/seller/dto/inputs/seller-update-store-basic-info.input';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import { toStoreOutput } from '@/features/seller/services/seller-store-mappers.helper';
import type { ISellerStoreProfileService } from '@/features/seller/services/seller-store-profile.service.interface';
import type { SellerStoreOutput } from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerStoreProfileService
  extends SellerBaseService
  implements ISellerStoreProfileService
{
  constructor(
    repo: SellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerMyStore(accountId: bigint): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const store = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!store) throw new NotFoundException(STORE_NOT_FOUND);
    return toStoreOutput(store);
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

    await this.auditLogs.createAuditLog({
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

    return toStoreOutput(updated);
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
}
