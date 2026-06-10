import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType, Prisma } from '@prisma/client';

import { parseId } from '@/common/utils/id-parser';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { ProductRepository } from '@/features/product';
import {
  PRODUCT_NOT_FOUND,
  SALE_PRICE_EXCEEDS_REGULAR,
} from '@/features/seller/constants/seller-error-messages';
import {
  DEFAULT_PREPARATION_TIME_MINUTES,
  MAX_PRODUCT_DESCRIPTION_LENGTH,
  MAX_PRODUCT_NAME_LENGTH,
  MAX_PRODUCT_PRICE,
  MAX_PRODUCT_PURCHASE_NOTICE_LENGTH,
  MAX_URL_LENGTH,
  MIN_PRODUCT_PRICE,
  MIN_SALE_PRICE,
} from '@/features/seller/constants/seller.constants';
import type { SellerCreateProductInput } from '@/features/seller/dto/inputs/seller-create-product.input';
import type { SellerSetProductActiveInput } from '@/features/seller/dto/inputs/seller-set-product-active.input';
import type { SellerUpdateProductInput } from '@/features/seller/dto/inputs/seller-update-product.input';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import type { ISellerProductLifecycleService } from '@/features/seller/services/seller-product-lifecycle.service.interface';
import { toProductOutput } from '@/features/seller/services/seller-product-mappers.helper';
import type { SellerProductOutput } from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerProductLifecycleService
  extends SellerBaseService
  implements ISellerProductLifecycleService
{
  constructor(
    repo: SellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly productRepository: ProductRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerCreateProduct(
    accountId: bigint,
    input: SellerCreateProductInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);

    this.validateProductPrices(input.regularPrice, input.salePrice);

    const created = await this.productRepository.createProduct({
      storeId: ctx.storeId,
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
        base_design_image_url: cleanNullableText(
          input.baseDesignImageUrl,
          MAX_URL_LENGTH,
        ),
        preparation_time_minutes:
          input.preparationTimeMinutes ?? DEFAULT_PREPARATION_TIME_MINUTES,
        is_active: input.isActive ?? true,
      },
    });

    await this.productRepository.addProductImage({
      productId: created.id,
      imageUrl: cleanRequiredText(input.initialImageUrl, MAX_URL_LENGTH),
      sortOrder: 0,
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: created.id,
      action: AuditActionType.CREATE,
      afterJson: {
        name: created.name,
        regularPrice: created.regular_price,
      },
    });

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
        productId: created.id,
        storeId: ctx.storeId,
      });
    if (!detail) throw new NotFoundException(PRODUCT_NOT_FOUND);
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
    if (!current) throw new NotFoundException(PRODUCT_NOT_FOUND);

    const data = this.buildProductUpdateData(input);
    const nextRegularPrice = input.regularPrice ?? current.regular_price;
    const nextSalePrice =
      input.salePrice !== undefined ? input.salePrice : current.sale_price;
    this.validateProductPrices(nextRegularPrice, nextSalePrice);

    const updated = await this.productRepository.updateProduct({
      productId,
      data,
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      beforeJson: {
        name: current.name,
      },
      afterJson: {
        name: updated.name,
      },
    });

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!detail) throw new NotFoundException(PRODUCT_NOT_FOUND);

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
    if (!current) throw new NotFoundException(PRODUCT_NOT_FOUND);

    await this.productRepository.softDeleteProduct(productId);
    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.DELETE,
      beforeJson: {
        name: current.name,
      },
    });
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
    if (!current) throw new NotFoundException(PRODUCT_NOT_FOUND);

    await this.productRepository.updateProduct({
      productId,
      data: {
        is_active: input.isActive,
      },
    });

    await this.auditLogs.createAuditLog({
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
    });

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!detail) throw new NotFoundException(PRODUCT_NOT_FOUND);
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
        throw new BadRequestException(SALE_PRICE_EXCEEDS_REGULAR);
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
