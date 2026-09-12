import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import {
  nextCursorOf,
  normalizeCursorInput,
} from '@/common/utils/id-cursor-page';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
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
  AdminCursorConnection,
  AdminProductDetailOutput,
  AdminProductOutput,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';

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
  ): Promise<AdminCursorConnection<AdminProductOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
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
    const paged = nextCursorOf(rows, normalized.limit);
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
    const current = await this.repo.findProductById(parseId(input.productId));
    if (!current) throw new NotFoundException(PRODUCT_NOT_FOUND);
    // 같은 값이면 멱등 — 감사 기록도 남기지 않는다
    if (current.is_active === input.isActive) {
      return toAdminProductOutput(current);
    }

    const updated = await this.repo.setProductActive(
      { productId: current.id, isActive: input.isActive },
      (row) => ({
        actorAccountId: ctx.accountId,
        storeId: row.store_id,
        targetType: AuditTargetType.PRODUCT,
        targetId: row.id,
        action: AuditActionType.STATUS_CHANGE,
        beforeJson: { isActive: current.is_active },
        afterJson: {
          isActive: row.is_active,
          reason: cleanNullableText(input.reason, MAX_REASON_LENGTH),
        },
      }),
    );
    return toAdminProductOutput(updated);
  }
}
