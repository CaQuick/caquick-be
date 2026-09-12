import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { STORE_NOT_FOUND } from '@/features/seller/constants/seller-error-messages';
import type { SellerUpdateStoreBasicInfoInput } from '@/features/seller/dto/inputs/seller-update-store-basic-info.input';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import { toStoreOutput } from '@/features/seller/services/seller-store-mappers.helper';
import type { ISellerStoreProfileService } from '@/features/seller/services/seller-store-profile.service.interface';
import type { SellerStoreOutput } from '@/features/seller/types/seller-output.type';
import { buildStoreBasicInfoUpdateData } from '@/features/store';

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

    // 갱신 규칙은 store feature의 공용 헬퍼가 단일 소스(관리자 대리 수정과 공유)
    const data = buildStoreBasicInfoUpdateData(input);
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
}
