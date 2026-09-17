import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { ProductRepository } from '@/features/product';
import type { SellerProductListInput } from '@/features/seller/dto/inputs/seller-product-list.input';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import { toProductOutput } from '@/features/seller/services/seller-product-mappers.helper';
import type { SellerProductOutput } from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerProductQueryService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly productRepository: ProductRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerProducts(
    accountId: bigint,
    input?: SellerProductListInput,
  ): Promise<CursorConnection<SellerProductOutput>> {
    const ctx = await this.requireSellerContext(accountId);

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });

    const filters = {
      storeId: ctx.storeId,
      isActive: input?.isActive ?? true,
      categoryId: input?.categoryId ? parseId(input.categoryId) : undefined,
      search: input?.search?.trim() || undefined,
    };

    const [rows, totalCount] = await Promise.all([
      this.productRepository.listProductsByStore({
        ...filters,
        limit: normalized.limit,
        cursor: normalized.cursor,
      }),
      this.productRepository.countProductsByStore(filters),
    ]);

    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map((row) => toProductOutput(row)),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
      totalCount,
    };
  }

  async sellerProduct(
    accountId: bigint,
    productId: bigint,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const row = await this.productRepository.findProductById({
      productId,
      storeId: ctx.storeId,
    });

    if (!row) throw new DomainException('PRODUCT_NOT_FOUND');
    return toProductOutput(row);
  }
}
