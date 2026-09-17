import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { ProductRepository } from '@/features/product';
import type { SellerSetProductCategoriesInput } from '@/features/seller/dto/inputs/seller-set-product-categories.input';
import type { SellerSetProductTagsInput } from '@/features/seller/dto/inputs/seller-set-product-tags.input';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import { toProductOutput } from '@/features/seller/services/seller-product-mappers.helper';
import type { SellerProductOutput } from '@/features/seller/types/seller-output.type';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';

@Injectable()
export class SellerProductTaxonomyService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly productRepository: ProductRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerSetProductCategories(
    accountId: bigint,
    input: SellerSetProductCategoriesInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new DomainException('PRODUCT_NOT_FOUND');

    const categoryIds = this.parseIdList(input.categoryIds);
    const categories =
      await this.productRepository.findCategoryIds(categoryIds);
    if (categories.length !== categoryIds.length) {
      throw new DomainException('INVALID_IDS', { field: 'categoryIds' });
    }

    await this.productRepository.replaceProductCategories({
      productId,
      categoryIds,
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        categoryIds: categoryIds.map((id) => id.toString()),
      },
    });

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!detail) throw new DomainException('PRODUCT_NOT_FOUND');

    return toProductOutput(detail);
  }

  async sellerSetProductTags(
    accountId: bigint,
    input: SellerSetProductTagsInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new DomainException('PRODUCT_NOT_FOUND');

    const tagIds = this.parseIdList(input.tagIds);
    const tags = await this.productRepository.findTagIds(tagIds);
    if (tags.length !== tagIds.length) {
      throw new DomainException('INVALID_IDS', { field: 'tagIds' });
    }

    await this.productRepository.replaceProductTags({
      productId,
      tagIds,
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        tagIds: tagIds.map((id) => id.toString()),
      },
    });

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!detail) throw new DomainException('PRODUCT_NOT_FOUND');

    return toProductOutput(detail);
  }
}
