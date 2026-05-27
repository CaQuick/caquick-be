import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { ProductRepository } from '@/features/product';
import { PRODUCT_NOT_FOUND } from '@/features/seller/constants/seller-error-messages';
import type { SellerProductListInput } from '@/features/seller/dto/inputs/seller-product-list.input';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import { toProductOutput } from '@/features/seller/services/seller-product-mappers.helper';
import type { ISellerProductQueryService } from '@/features/seller/services/seller-product-query.service.interface';
import type {
  SellerCursorConnection,
  SellerProductOutput,
} from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerProductQueryService
  extends SellerBaseService
  implements ISellerProductQueryService
{
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
  ): Promise<SellerCursorConnection<SellerProductOutput>> {
    const ctx = await this.requireSellerContext(accountId);

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const rows = await this.productRepository.listProductsByStore({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      isActive: input?.isActive ?? true,
      categoryId: input?.categoryId ? parseId(input.categoryId) : undefined,
      search: input?.search?.trim() || undefined,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => toProductOutput(row)),
      nextCursor: paged.nextCursor,
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

    if (!row) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return toProductOutput(row);
  }
}
