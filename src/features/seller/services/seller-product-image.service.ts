import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { ProductRepository } from '@/features/product';
import {
  IMAGE_LIMIT_EXCEEDED,
  IMAGE_MIN_REQUIRED,
  idsMismatchError,
  invalidIdsError,
  PRODUCT_IMAGE_NOT_FOUND,
  PRODUCT_NOT_FOUND,
} from '@/features/seller/constants/seller-error-messages';
import {
  MAX_PRODUCT_IMAGES,
  MAX_URL_LENGTH,
  MIN_PRODUCT_IMAGES,
} from '@/features/seller/constants/seller.constants';
import type { SellerAddProductImageInput } from '@/features/seller/dto/inputs/seller-add-product-image.input';
import type { SellerReorderProductImagesInput } from '@/features/seller/dto/inputs/seller-reorder-product-images.input';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import type { ISellerProductImageService } from '@/features/seller/services/seller-product-image.service.interface';
import { toProductImageOutput } from '@/features/seller/services/seller-product-mappers.helper';
import type { SellerProductImageOutput } from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerProductImageService
  extends SellerBaseService
  implements ISellerProductImageService
{
  constructor(
    repo: SellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly productRepository: ProductRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerAddProductImage(
    accountId: bigint,
    input: SellerAddProductImageInput,
  ): Promise<SellerProductImageOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);

    const count = await this.productRepository.countProductImages(productId);
    if (count >= MAX_PRODUCT_IMAGES) {
      throw new BadRequestException(IMAGE_LIMIT_EXCEEDED);
    }

    const row = await this.productRepository.addProductImage({
      productId,
      imageUrl: cleanRequiredText(input.imageUrl, MAX_URL_LENGTH),
      sortOrder: input.sortOrder ?? count,
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        imageId: row.id.toString(),
      },
    });

    return toProductImageOutput(row);
  }

  async sellerDeleteProductImage(
    accountId: bigint,
    imageId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const image = await this.productRepository.findProductImageById(imageId);
    if (!image || image.product.store_id !== ctx.storeId) {
      throw new NotFoundException(PRODUCT_IMAGE_NOT_FOUND);
    }

    const count = await this.productRepository.countProductImages(
      image.product_id,
    );
    if (count <= MIN_PRODUCT_IMAGES) {
      throw new BadRequestException(IMAGE_MIN_REQUIRED);
    }

    await this.productRepository.softDeleteProductImage(imageId);
    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: image.product_id,
      action: AuditActionType.UPDATE,
      beforeJson: {
        imageId: image.id.toString(),
      },
    });

    return true;
  }

  async sellerReorderProductImages(
    accountId: bigint,
    input: SellerReorderProductImagesInput,
  ): Promise<SellerProductImageOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);
    const imageIds = this.parseIdList(input.imageIds);

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);

    const existing = await this.productRepository.listProductImages(productId);
    if (existing.length !== imageIds.length) {
      throw new BadRequestException(idsMismatchError('imageIds'));
    }

    const existingSet = new Set(existing.map((row) => row.id.toString()));
    for (const id of imageIds) {
      if (!existingSet.has(id.toString())) {
        throw new BadRequestException(invalidIdsError('imageIds'));
      }
    }

    const rows = await this.productRepository.reorderProductImages({
      productId,
      imageIds,
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        imageIds: imageIds.map((id) => id.toString()),
      },
    });

    return rows.map((row) => toProductImageOutput(row));
  }
}
