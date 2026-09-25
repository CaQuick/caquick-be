import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  MAX_PRODUCT_IMAGES,
  MAX_URL_LENGTH,
  MIN_PRODUCT_IMAGES,
} from '@/features/product/constants/product-seller.constants';
import type { SellerAddProductImageInput } from '@/features/product/dto/inputs/seller-add-product-image.input';
import type { SellerReorderProductImagesInput } from '@/features/product/dto/inputs/seller-reorder-product-images.input';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { toProductImageOutput } from '@/features/product/services/product-seller-mappers.helper';
import type { SellerProductImageOutput } from '@/features/product/types/product-seller-output.type';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';
import { assertOwnedUploadUrl } from '@/global/storage/assert-owned-upload-url';
import { S3Service } from '@/global/storage/s3.service';

@Injectable()
export class SellerProductImageService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly productRepository: ProductRepository,
    private readonly s3: S3Service,
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
    if (!product) throw new DomainException('PRODUCT_NOT_FOUND');

    const count = await this.productRepository.countProductImages(productId);
    if (count >= MAX_PRODUCT_IMAGES) {
      throw new DomainException('PRODUCT_IMAGE_LIMIT_EXCEEDED', {
        max: MAX_PRODUCT_IMAGES,
      });
    }

    const imageUrl = cleanRequiredText(input.imageUrl, MAX_URL_LENGTH);
    assertOwnedUploadUrl(
      this.s3,
      imageUrl,
      'PRODUCT_IMAGE',
      ctx.accountId,
      'INVALID_IMAGE_URL',
    );

    // 감사 기록은 repository가 같은 트랜잭션에서 남긴다
    const row = await this.productRepository.addProductImage(
      {
        productId,
        imageUrl,
        sortOrder: input.sortOrder ?? count,
      },
      (created) => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: productId,
        action: AuditActionType.UPDATE,
        afterJson: {
          imageId: created.id.toString(),
        },
      }),
    );

    return toProductImageOutput(row);
  }

  async sellerDeleteProductImage(
    accountId: bigint,
    imageId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const image = await this.productRepository.findProductImageById(imageId);
    if (!image || image.product.store_id !== ctx.storeId) {
      throw new DomainException('PRODUCT_IMAGE_NOT_FOUND');
    }

    const count = await this.productRepository.countProductImages(
      image.product_id,
    );
    if (count <= MIN_PRODUCT_IMAGES) {
      throw new DomainException('PRODUCT_IMAGE_MIN_REQUIRED');
    }

    await this.productRepository.softDeleteProductImage(imageId, () => ({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: image.product_id,
      action: AuditActionType.UPDATE,
      beforeJson: {
        imageId: image.id.toString(),
      },
    }));

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
    if (!product) throw new DomainException('PRODUCT_NOT_FOUND');

    const existing = await this.productRepository.listProductImages(productId);
    if (existing.length !== imageIds.length) {
      throw new DomainException('IDS_LENGTH_MISMATCH', { field: 'imageIds' });
    }

    const existingSet = new Set(existing.map((row) => row.id.toString()));
    for (const id of imageIds) {
      if (!existingSet.has(id.toString())) {
        throw new DomainException('INVALID_IDS', { field: 'imageIds' });
      }
    }

    const rows = await this.productRepository.reorderProductImages(
      {
        productId,
        imageIds,
      },
      () => ({
        actorAccountId: ctx.accountId,
        storeId: ctx.storeId,
        targetType: AuditTargetType.PRODUCT,
        targetId: productId,
        action: AuditActionType.UPDATE,
        afterJson: {
          imageIds: imageIds.map((id) => id.toString()),
        },
      }),
    );

    return rows.map((row) => toProductImageOutput(row));
  }
}
