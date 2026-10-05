import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { MAX_TAG_NAME_LENGTH } from '@/features/product/constants/product-admin.constants';
import {
  DEFAULT_TAG_SUGGESTIONS,
  MAX_TAGS_PER_PRODUCT,
} from '@/features/product/constants/product-seller.constants';
import type { SellerSetProductCategoriesInput } from '@/features/product/dto/inputs/seller-set-product-categories.input';
import type { SellerSetProductTagsByNameInput } from '@/features/product/dto/inputs/seller-set-product-tags-by-name.input';
import type { SellerSetProductTagsInput } from '@/features/product/dto/inputs/seller-set-product-tags.input';
import type { SellerTagSearchInput } from '@/features/product/dto/inputs/seller-tag-search.input';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { toProductOutput } from '@/features/product/services/product-seller-mappers.helper';
import { normalizeTagName } from '@/features/product/services/tag-name.helper';
import type {
  SellerProductOutput,
  SellerTagSuggestionOutput,
} from '@/features/product/types/product-seller-output.type';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';

@Injectable()
export class SellerProductTaxonomyService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
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

    // 감사 기록은 repository가 같은 트랜잭션에서 남긴다
    await this.productRepository.replaceProductCategories(
      {
        productId,
        categoryIds,
      },
      () => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: productId,
        action: AuditActionType.UPDATE,
        afterJson: {
          categoryIds: categoryIds.map((id) => id.toString()),
        },
      }),
    );

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!detail) throw new DomainException('PRODUCT_NOT_FOUND');

    return toProductOutput(detail);
  }

  async sellerSearchTags(
    accountId: bigint,
    input: SellerTagSearchInput,
  ): Promise<SellerTagSuggestionOutput[]> {
    await this.requireSellerContext(accountId);
    const keyword = normalizeTagName(input.keyword);
    if (keyword === null) return [];
    cleanRequiredText(keyword, MAX_TAG_NAME_LENGTH);

    const limit = input.limit ?? DEFAULT_TAG_SUGGESTIONS;
    const { exact, rows } = await this.productRepository.searchTagsByName({
      keyword,
      limit,
    });
    const ordered = exact
      ? [exact, ...rows.filter((row) => row.id !== exact.id)]
      : rows;
    return ordered.slice(0, limit).map((row) => ({
      id: row.id.toString(),
      name: row.name,
      isExactMatch: row.id === exact?.id,
      productCount: row._count.product_tags,
    }));
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

    await this.productRepository.replaceProductTags(
      {
        productId,
        tagIds,
      },
      () => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: productId,
        action: AuditActionType.UPDATE,
        afterJson: {
          tagIds: tagIds.map((id) => id.toString()),
        },
      }),
    );

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!detail) throw new DomainException('PRODUCT_NOT_FOUND');

    return toProductOutput(detail);
  }

  async sellerSetProductTagsByName(
    accountId: bigint,
    input: SellerSetProductTagsByNameInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new DomainException('PRODUCT_NOT_FOUND');

    const names = [
      ...new Set(
        input.names.map((raw) => {
          const name = normalizeTagName(
            cleanRequiredText(raw, MAX_TAG_NAME_LENGTH),
          );
          if (name === null) throw new DomainException('TEXT_REQUIRED');
          // 소문자화로 코드 포인트가 늘 수 있어('İ' → 'i̇') VARCHAR(80)에 맞게 다시 본다
          return cleanRequiredText(name, MAX_TAG_NAME_LENGTH);
        }),
      ),
    ];
    if (names.length > MAX_TAGS_PER_PRODUCT) {
      throw new DomainException('PRODUCT_TAG_LIMIT_EXCEEDED', {
        max: MAX_TAGS_PER_PRODUCT,
      });
    }

    await this.productRepository.replaceProductTagsByName(
      { productId, names },
      (tagIds) => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: productId,
        action: AuditActionType.UPDATE,
        afterJson: {
          tagNames: names,
          tagIds: tagIds.map((id) => id.toString()),
        },
      }),
    );

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!detail) throw new DomainException('PRODUCT_NOT_FOUND');

    return toProductOutput(detail);
  }
}
