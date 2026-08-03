import { Module } from '@nestjs/common';

import { ProductReviewRepository } from '@/features/product/repositories/product-review.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductDetailQueryResolver } from '@/features/product/resolvers/product-detail-query.resolver';
import { ProductReviewQueryResolver } from '@/features/product/resolvers/product-review-query.resolver';
import { ProductStorefrontQueryResolver } from '@/features/product/resolvers/product-storefront-query.resolver';
import { ProductDetailService } from '@/features/product/services/product-detail.service';
import { ProductReviewService } from '@/features/product/services/product-review.service';
import { ProductStorefrontService } from '@/features/product/services/product-storefront.service';

@Module({
  providers: [
    ProductRepository,
    ProductReviewRepository,
    ProductDetailService,
    ProductDetailQueryResolver,
    ProductReviewService,
    ProductReviewQueryResolver,
    ProductStorefrontService,
    ProductStorefrontQueryResolver,
  ],
  exports: [ProductRepository],
})
export class ProductModule {}
