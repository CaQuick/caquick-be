import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import type { SellerUpdateStoreBasicInfoInput } from '@/features/store/dto/inputs/seller-update-store-basic-info.input';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { buildStoreBasicInfoUpdateData } from '@/features/store/services/store-basic-info.helper';
import { toStoreOutput } from '@/features/store/services/store-output-mappers.helper';
import { SellerBaseService } from '@/features/store/services/store-seller-base.service';
import type { SellerStoreOutput } from '@/features/store/types/store-seller-output.type';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';
import { assertOwnedUploadUrl } from '@/global/storage/assert-owned-upload-url';
import { S3Service } from '@/global/storage/s3.service';

@Injectable()
export class SellerStoreProfileService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly s3: S3Service,
  ) {
    super(repo, auditLogs);
  }

  async sellerMyStore(accountId: bigint): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const store = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!store) throw new DomainException('STORE_NOT_FOUND');
    return toStoreOutput(store);
  }

  async sellerUpdateStoreBasicInfo(
    accountId: bigint,
    input: SellerUpdateStoreBasicInfoInput,
  ): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!current) throw new DomainException('STORE_NOT_FOUND');

    // 갱신 규칙은 store feature의 공용 헬퍼가 단일 소스(관리자 대리 수정과 공유)
    const data = buildStoreBasicInfoUpdateData(input);
    if (typeof data.profile_image_url === 'string') {
      assertOwnedUploadUrl(
        this.s3,
        data.profile_image_url,
        'STORE_IMAGE',
        ctx.accountId,
        'INVALID_IMAGE_URL',
      );
    }
    const updated = await this.repo.updateStore(
      {
        storeId: ctx.storeId,
        data,
      },
      (created) => ({
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
          storeName: created.store_name,
          storePhone: created.store_phone,
        },
      }),
    );
    return toStoreOutput(updated);
  }
}
