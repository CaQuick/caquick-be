import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';

import { domainError } from '@/common/errors';
import {
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  parseDecimalOrNull,
} from '@/common/utils/decimal-parser';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import {
  sliceIdCursorPage,
  normalizeCursorInput,
} from '@/common/utils/pagination';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_URL_LENGTH,
} from '@/features/admin/constants/admin.constants';
import type { AdminCreateSellerInput } from '@/features/admin/dto/inputs/admin-create-seller.input';
import type { AdminResetSellerPasswordInput } from '@/features/admin/dto/inputs/admin-reset-seller-password.input';
import type { AdminSellerListInput } from '@/features/admin/dto/inputs/admin-seller-list.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import { toAdminSellerOutput } from '@/features/admin/services/admin-seller-mappers.helper';
import type {
  AdminCursorConnection,
  AdminSellerOutput,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  MAX_ADDRESS_CITY_LENGTH,
  MAX_ADDRESS_DISTRICT_LENGTH,
  MAX_ADDRESS_FULL_LENGTH,
  MAX_ADDRESS_NEIGHBORHOOD_LENGTH,
  MAX_BUSINESS_NAME_LENGTH,
  MAX_BUSINESS_PHONE_LENGTH,
  MAX_STORE_NAME_LENGTH,
  MAX_STORE_PHONE_LENGTH,
} from '@/features/store';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';

/**
 * 판매자 온보딩·조회·비밀번호 초기화. 판매자 계정은 시드 외 생성 경로가 없었다.
 * 매장은 기본 정보만 만들고 영업시간·픽업 정책은 판매자가 seller* API로 직접 설정한다.
 */
@Injectable()
export class AdminSellerService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async adminSellers(
    accountId: bigint,
    input?: AdminSellerListInput,
  ): Promise<AdminCursorConnection<AdminSellerOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });
    const filter = {
      keyword: input?.keyword?.trim() || undefined,
      status: input?.status,
    };

    const [rows, totalCount] = await Promise.all([
      this.repo.listSellerAccounts({ ...filter, ...normalized }),
      this.repo.countSellerAccounts(filter),
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
    const row = await this.repo.findSellerAccountById(targetAccountId);
    if (!row) throw domainError('SELLER_NOT_FOUND');
    return toAdminSellerOutput(row);
  }

  async adminCreateSeller(
    accountId: bigint,
    input: AdminCreateSellerInput,
  ): Promise<AdminSellerOutput> {
    const ctx = await this.requireAdminContext(accountId);
    if (await this.repo.existsCredentialUsername(input.username)) {
      throw domainError('USERNAME_TAKEN');
    }

    const regionId = parseOptionalId(input.store.regionId);
    if (regionId !== null && !(await this.repo.isRegionSelectable(regionId))) {
      throw domainError('REGION_NOT_SELECTABLE');
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const created = await this.repo.createSellerAccount({
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
        website_url: cleanNullableText(input.websiteUrl, MAX_URL_LENGTH),
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
        latitude: parseDecimalOrNull(
          input.store.latitude,
          'INVALID_DECIMAL_VALUE',
          LATITUDE_RANGE,
        ),
        longitude: parseDecimalOrNull(
          input.store.longitude,
          'INVALID_DECIMAL_VALUE',
          LONGITUDE_RANGE,
        ),
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
    const target = await this.repo.findSellerAccountById(
      parseId(input.accountId),
    );
    // 자격증명이 없거나 삭제된 계정은 초기화할 로그인 수단이 없다(로그인도 삭제된 자격증명을 제외한다)
    if (!target?.credential || target.credential.deleted_at !== null) {
      throw domainError('SELLER_NOT_FOUND');
    }

    const passwordHash = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
    });
    await this.repo.resetCredentialPassword({
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
