import { Injectable, NotFoundException } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { PRODUCT_DETAIL_ERRORS } from '@/features/product/constants/product-detail-error-messages';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { toProductDetail } from '@/features/product/services/product-detail-mappers.helper';
import type { ProductDetail } from '@/features/product/types/product-detail-output.type';

@Injectable()
export class ProductDetailService {
  constructor(private readonly repo: ProductRepository) {}

  /**
   * 상품 상세. 비활성/삭제 상품(또는 매장)은 NOT_FOUND.
   * 리뷰 수는 실시간 집계, isWishlisted는 로그인 사용자에 한해 채운다(비로그인 false).
   */
  async productDetail(
    productIdRaw: string,
    accountId?: bigint,
  ): Promise<ProductDetail> {
    const productId = parseId(productIdRaw);
    const row = await this.repo.findProductDetailById(productId);
    if (!row) {
      throw new NotFoundException(PRODUCT_DETAIL_ERRORS.PRODUCT_NOT_FOUND);
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
