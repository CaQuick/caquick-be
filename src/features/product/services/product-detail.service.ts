import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { toProductDetail } from '@/features/product/services/product-detail-mappers.helper';
import type { ProductDetail } from '@/features/product/types/product-detail-output.type';
import { ReviewReadRepository, WishlistRepository } from '@/features/review';

@Injectable()
export class ProductDetailService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly reviews: ReviewReadRepository,
    private readonly wishlists: WishlistRepository,
  ) {}

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
      this.reviews.countProductReviews(productId),
      accountId !== undefined
        ? this.wishlists.isProductWishlisted({ accountId, productId })
        : Promise.resolve(false),
    ]);

    return toProductDetail(row, reviewCount, isWishlisted);
  }
}
