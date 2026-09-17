import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import { PRODUCT_NOT_FOUND } from '@/features/admin/constants/admin-error-messages';
import { MAX_REASON_LENGTH } from '@/features/admin/constants/admin.constants';
import type { AdminProductListInput } from '@/features/admin/dto/inputs/admin-product-list.input';
import type { AdminSetProductActiveInput } from '@/features/admin/dto/inputs/admin-set-product-active.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import {
  toAdminProductDetailOutput,
  toAdminProductOutput,
} from '@/features/admin/services/admin-product-mappers.helper';
import type {
  AdminProductDetailOutput,
  AdminProductOutput,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';

/** 상품 조회와 강제 비활성. 내용 수정은 판매자 몫이라 관리자에게 열지 않는다. */
@Injectable()
export class AdminProductService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async adminProducts(
    accountId: bigint,
    input?: AdminProductListInput,
  ): Promise<CursorConnection<AdminProductOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });
    const filter = {
      keyword: input?.keyword?.trim() || undefined,
      storeId: parseOptionalId(input?.storeId) ?? undefined,
      isActive: input?.isActive,
    };

    const [rows, totalCount] = await Promise.all([
      this.repo.listProducts({ ...filter, ...normalized }),
      this.repo.countProducts(filter),
    ]);
    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminProductOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminProduct(
    accountId: bigint,
    productId: bigint,
  ): Promise<AdminProductDetailOutput> {
    await this.requireAdminContext(accountId);
    const row = await this.repo.findProductDetailById(productId);
    if (!row) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return toAdminProductDetailOutput(row);
  }

  async adminSetProductActive(
    accountId: bigint,
    input: AdminSetProductActiveInput,
  ): Promise<AdminProductOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const reason = cleanNullableText(input.reason, MAX_REASON_LENGTH);
    // 현재 값 확인·멱등 판정·삭제 여부는 repository가 잠금 뒤 트랜잭션 안에서 본다
    const result = await this.repo.setProductActive(
      { productId: parseId(input.productId), isActive: input.isActive },
      (before, after) => ({
        actorAccountId: ctx.accountId,
        storeId: after.store_id,
        targetType: AuditTargetType.PRODUCT,
        targetId: after.id,
        action: AuditActionType.STATUS_CHANGE,
        beforeJson: { isActive: before.is_active },
        afterJson: { isActive: after.is_active, reason },
      }),
    );
    if (!result) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return toAdminProductOutput(result.row);
  }
}
