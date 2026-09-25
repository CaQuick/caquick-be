import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  DEFAULT_PREPARATION_TIME_MINUTES,
  MAX_PRODUCT_DESCRIPTION_LENGTH,
  MAX_PRODUCT_NAME_LENGTH,
  MAX_PRODUCT_PRICE,
  MAX_PRODUCT_PURCHASE_NOTICE_LENGTH,
  MAX_URL_LENGTH,
  MIN_PRODUCT_PRICE,
  MIN_SALE_PRICE,
} from '@/features/product/constants/product-seller.constants';
import type { SellerCreateProductInput } from '@/features/product/dto/inputs/seller-create-product.input';
import type { SellerSetProductActiveInput } from '@/features/product/dto/inputs/seller-set-product-active.input';
import type { SellerUpdateProductInput } from '@/features/product/dto/inputs/seller-update-product.input';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { toProductOutput } from '@/features/product/services/product-seller-mappers.helper';
import type { SellerProductOutput } from '@/features/product/types/product-seller-output.type';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import {
  AuditActionType,
  AuditTargetType,
  Prisma,
} from '@/generated/prisma/client';
import { assertOwnedUploadUrl } from '@/global/storage/assert-owned-upload-url';
import { S3Service } from '@/global/storage/s3.service';

@Injectable()
export class SellerProductLifecycleService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly productRepository: ProductRepository,
    private readonly s3: S3Service,
  ) {
    super(repo, auditLogs);
  }

  async sellerCreateProduct(
    accountId: bigint,
    input: SellerCreateProductInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);

    this.validateProductPrices(input.regularPrice, input.salePrice);

    const baseDesignImageUrl = cleanNullableText(
      input.baseDesignImageUrl,
      MAX_URL_LENGTH,
    );
    const initialImageUrl = cleanRequiredText(
      input.initialImageUrl,
      MAX_URL_LENGTH,
    );
    assertOwnedUploadUrl(
      this.s3,
      baseDesignImageUrl,
      'PRODUCT_IMAGE',
      ctx.accountId,
      'INVALID_IMAGE_URL',
    );
    assertOwnedUploadUrl(
      this.s3,
      initialImageUrl,
      'PRODUCT_IMAGE',
      ctx.accountId,
      'INVALID_IMAGE_URL',
    );

    // 상품·대표 이미지·감사 기록을 한 트랜잭션에서 남긴다
    const created = await this.productRepository.createProduct(
      {
        storeId: ctx.storeId,
        initialImageUrl,
        data: {
          name: cleanRequiredText(input.name, MAX_PRODUCT_NAME_LENGTH),
          description: cleanNullableText(
            input.description,
            MAX_PRODUCT_DESCRIPTION_LENGTH,
          ),
          purchase_notice: cleanNullableText(
            input.purchaseNotice,
            MAX_PRODUCT_PURCHASE_NOTICE_LENGTH,
          ),
          regular_price: input.regularPrice,
          sale_price: input.salePrice ?? null,
          currency: this.cleanCurrency(input.currency),
          base_design_image_url: baseDesignImageUrl,
          preparation_time_minutes:
            input.preparationTimeMinutes ?? DEFAULT_PREPARATION_TIME_MINUTES,
          is_active: input.isActive ?? true,
        },
      },
      (product) => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: product.id,
        action: AuditActionType.CREATE,
        afterJson: {
          name: product.name,
          regularPrice: product.regular_price,
        },
      }),
    );

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
        productId: created.id,
        storeId: ctx.storeId,
      });
    if (!detail) throw new DomainException('PRODUCT_NOT_FOUND');
    return toProductOutput(detail);
  }

  async sellerUpdateProduct(
    accountId: bigint,
    input: SellerUpdateProductInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

    const current =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!current) throw new DomainException('PRODUCT_NOT_FOUND');

    const data = this.buildProductUpdateData(input);
    if (typeof data.base_design_image_url === 'string') {
      assertOwnedUploadUrl(
        this.s3,
        data.base_design_image_url,
        'PRODUCT_IMAGE',
        ctx.accountId,
        'INVALID_IMAGE_URL',
      );
    }
    const nextRegularPrice = input.regularPrice ?? current.regular_price;
    const nextSalePrice =
      input.salePrice !== undefined ? input.salePrice : current.sale_price;
    this.validateProductPrices(nextRegularPrice, nextSalePrice);

    await this.productRepository.updateProduct(
      {
        productId,
        data,
      },
      (created) => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: productId,
        action: AuditActionType.UPDATE,
        beforeJson: {
          name: current.name,
        },
        afterJson: {
          name: created.name,
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

  async sellerDeleteProduct(
    accountId: bigint,
    productId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const current =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!current) throw new DomainException('PRODUCT_NOT_FOUND');

    await this.productRepository.softDeleteProduct(productId, () => ({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.DELETE,
      beforeJson: {
        name: current.name,
      },
    }));
    return true;
  }

  async sellerSetProductActive(
    accountId: bigint,
    input: SellerSetProductActiveInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

    const current =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!current) throw new DomainException('PRODUCT_NOT_FOUND');

    await this.productRepository.updateProduct(
      {
        productId,
        data: {
          is_active: input.isActive,
        },
      },
      () => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: productId,
        action: AuditActionType.STATUS_CHANGE,
        beforeJson: {
          isActive: current.is_active,
        },
        afterJson: {
          isActive: input.isActive,
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

  private validateProductPrices(
    regularPrice?: number,
    salePrice?: number | null,
  ): void {
    if (regularPrice !== undefined) {
      this.assertPositiveRange(
        regularPrice,
        MIN_PRODUCT_PRICE,
        MAX_PRODUCT_PRICE,
        'regularPrice',
      );
    }

    if (salePrice !== undefined && salePrice !== null) {
      this.assertPositiveRange(
        salePrice,
        MIN_SALE_PRICE,
        MAX_PRODUCT_PRICE,
        'salePrice',
      );
      if (regularPrice !== undefined && salePrice > regularPrice) {
        throw new DomainException('SALE_PRICE_EXCEEDS_REGULAR');
      }
    }
  }

  private buildProductUpdateData(
    input: SellerUpdateProductInput,
  ): Prisma.ProductUpdateInput {
    return {
      ...(input.name !== undefined
        ? { name: cleanRequiredText(input.name, MAX_PRODUCT_NAME_LENGTH) }
        : {}),
      ...(input.description !== undefined
        ? {
            description: cleanNullableText(
              input.description,
              MAX_PRODUCT_DESCRIPTION_LENGTH,
            ),
          }
        : {}),
      ...(input.purchaseNotice !== undefined
        ? {
            purchase_notice: cleanNullableText(
              input.purchaseNotice,
              MAX_PRODUCT_PURCHASE_NOTICE_LENGTH,
            ),
          }
        : {}),
      ...(input.regularPrice !== undefined && input.regularPrice !== null
        ? { regular_price: input.regularPrice }
        : {}),
      ...(input.salePrice !== undefined ? { sale_price: input.salePrice } : {}),
      ...(input.currency !== undefined
        ? { currency: this.cleanCurrency(input.currency) }
        : {}),
      ...(input.baseDesignImageUrl !== undefined
        ? {
            base_design_image_url: cleanNullableText(
              input.baseDesignImageUrl,
              MAX_URL_LENGTH,
            ),
          }
        : {}),
      ...(input.preparationTimeMinutes !== undefined &&
      input.preparationTimeMinutes !== null
        ? { preparation_time_minutes: input.preparationTimeMinutes }
        : {}),
    };
  }
}
