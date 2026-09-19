import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';

import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import {
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  parseDecimalOrNull,
} from '@/common/utils/decimal-parser';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_SELLER_WEBSITE_URL_LENGTH,
} from '@/features/auth/constants/auth-admin.constants';
import type { AdminCreateSellerInput } from '@/features/auth/dto/inputs/admin-create-seller.input';
import type { AdminResetSellerPasswordInput } from '@/features/auth/dto/inputs/admin-reset-seller-password.input';
import type { AdminSellerListInput } from '@/features/auth/dto/inputs/admin-seller-list.input';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { AdminBaseService } from '@/features/auth/services/auth-admin-base.service';
import { toAdminSellerOutput } from '@/features/auth/services/auth-admin-mappers.helper';
import type { AdminSellerOutput } from '@/features/auth/types/auth-admin-output.type';
import {
  MAX_ADDRESS_CITY_LENGTH,
  MAX_ADDRESS_DISTRICT_LENGTH,
  MAX_ADDRESS_FULL_LENGTH,
  MAX_ADDRESS_NEIGHBORHOOD_LENGTH,
  MAX_BUSINESS_NAME_LENGTH,
  MAX_BUSINESS_PHONE_LENGTH,
  MAX_STORE_NAME_LENGTH,
  MAX_STORE_PHONE_LENGTH,
  StoreSellerRepository,
} from '@/features/store';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';

/** 매장은 기본 정보만 만들고 영업시간·픽업 정책은 판매자가 seller* API로 직접 설정한다. */
@Injectable()
export class AdminSellerService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly stores: StoreSellerRepository,
  ) {
    super(accounts, auditLogs);
  }

  async adminSellers(
    accountId: bigint,
    input?: AdminSellerListInput,
  ): Promise<CursorConnection<AdminSellerOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });
    const filter = {
      keyword: input?.keyword?.trim() || undefined,
      status: input?.status,
    };

    const [rows, totalCount] = await Promise.all([
      this.accounts.listSellerAccounts({ ...filter, ...normalized }),
      this.accounts.countSellerAccounts(filter),
    ]);
    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminSellerOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminSeller(
    accountId: bigint,
    targetAccountId: bigint,
  ): Promise<AdminSellerOutput> {
    await this.requireAdminContext(accountId);
    const row = await this.accounts.findSellerAccountById(targetAccountId);
    if (!row) throw new DomainException('SELLER_NOT_FOUND');
    return toAdminSellerOutput(row);
  }

  async adminCreateSeller(
    accountId: bigint,
    input: AdminCreateSellerInput,
  ): Promise<AdminSellerOutput> {
    const ctx = await this.requireAdminContext(accountId);
    if (await this.accounts.existsCredentialUsername(input.username)) {
      throw new DomainException('USERNAME_TAKEN');
    }

    const regionId = parseOptionalId(input.store.regionId);
    if (
      regionId !== null &&
      !(await this.stores.isRegionSelectable(regionId))
    ) {
      throw new DomainException('REGION_NOT_SELECTABLE');
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const created = await this.accounts.createSellerAccount({
      actorAccountId: ctx.accountId,
      username: input.username,
      passwordHash,
      email: cleanNullableText(input.email, MAX_EMAIL_LENGTH),
      name: cleanNullableText(input.name, MAX_ACCOUNT_NAME_LENGTH),
      profile: {
        business_name: cleanRequiredText(
          input.businessName,
          MAX_BUSINESS_NAME_LENGTH,
        ),
        business_phone: cleanRequiredText(
          input.businessPhone,
          MAX_BUSINESS_PHONE_LENGTH,
        ),
        website_url: cleanNullableText(
          input.websiteUrl,
          MAX_SELLER_WEBSITE_URL_LENGTH,
        ),
      },
      store: {
        store_name: cleanRequiredText(
          input.store.storeName,
          MAX_STORE_NAME_LENGTH,
        ),
        store_phone: cleanRequiredText(
          input.store.storePhone,
          MAX_STORE_PHONE_LENGTH,
        ),
        address_full: cleanRequiredText(
          input.store.addressFull,
          MAX_ADDRESS_FULL_LENGTH,
        ),
        address_city: cleanNullableText(
          input.store.addressCity,
          MAX_ADDRESS_CITY_LENGTH,
        ),
        address_district: cleanNullableText(
          input.store.addressDistrict,
          MAX_ADDRESS_DISTRICT_LENGTH,
        ),
        address_neighborhood: cleanNullableText(
          input.store.addressNeighborhood,
          MAX_ADDRESS_NEIGHBORHOOD_LENGTH,
        ),
        region_id: regionId,
        latitude: parseDecimalOrNull(input.store.latitude, LATITUDE_RANGE),
        longitude: parseDecimalOrNull(input.store.longitude, LONGITUDE_RANGE),
        map_provider: input.store.mapProvider ?? 'NONE',
      },
    });

    return toAdminSellerOutput(created);
  }

  async adminResetSellerPassword(
    accountId: bigint,
    input: AdminResetSellerPasswordInput,
  ): Promise<boolean> {
    const ctx = await this.requireAdminContext(accountId);
    const target = await this.accounts.findSellerAccountById(
      parseId(input.accountId),
    );
    // 자격증명이 없거나 삭제된 계정은 초기화할 로그인 수단이 없다(로그인도 삭제된 자격증명을 제외한다)
    if (!target?.credential || target.credential.deleted_at !== null) {
      throw new DomainException('SELLER_NOT_FOUND');
    }

    const passwordHash = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
    });
    await this.accounts.resetCredentialPassword({
      accountId: target.id,
      passwordHash,
      audit: {
        actorAccountId: ctx.accountId,
        storeId: target.store?.id ?? null,
        targetType: AuditTargetType.ACCOUNT,
        targetId: target.id,
        action: AuditActionType.UPDATE,
        afterJson: { passwordReset: true, mustChangePassword: true },
      },
    });
    return true;
  }
}
