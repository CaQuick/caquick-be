import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { toProductDetail } from '@/features/product/services/product-detail-mappers.helper';
import type { ProductDetail } from '@/features/product/types/product-detail-output.type';

@Injectable()
export class ProductDetailService {
  constructor(private readonly repo: ProductRepository) {}

  async productDetail(
    productIdRaw: string,
    accountId?: bigint,
  ): Promise<ProductDetail> {
    const productId = parseId(productIdRaw);
    const row = await this.repo.findProductDetailById(productId);
    if (!row) {
      throw new DomainException('PRODUCT_NOT_FOUND');
    }

    const [reviewCount, isWishlisted] = await Promise.all([
      this.repo.countProductReviews(productId),
      accountId !== undefined
        ? this.repo.isProductWishlisted({ accountId, productId })
        : Promise.resolve(false),
    ]);

    return toProductDetail(row, reviewCount, isWishlisted);
  }
}
