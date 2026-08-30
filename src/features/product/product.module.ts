import { Module } from '@nestjs/common';

import { ProductReviewRepository } from '@/features/product/repositories/product-review.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductCategoryQueryResolver } from '@/features/product/resolvers/product-category-query.resolver';
import { ProductDetailQueryResolver } from '@/features/product/resolvers/product-detail-query.resolver';
import { ProductHomeQueryResolver } from '@/features/product/resolvers/product-home-query.resolver';
import { ProductReviewQueryResolver } from '@/features/product/resolvers/product-review-query.resolver';
import { ProductStorefrontQueryResolver } from '@/features/product/resolvers/product-storefront-query.resolver';
import { ProductBestSellerService } from '@/features/product/services/product-best-seller.service';
import { ProductCategoryService } from '@/features/product/services/product-category.service';
import { ProductDetailService } from '@/features/product/services/product-detail.service';
import { ProductHomeService } from '@/features/product/services/product-home.service';
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
    ProductCategoryService,
    ProductCategoryQueryResolver,
    ProductHomeService,
    ProductHomeQueryResolver,
    ProductBestSellerService,
  ],
  // ProductBestSellerService는 검색 진입 화면(search feature)의 실시간 판매 Best가 소비한다
  exports: [ProductRepository, ProductBestSellerService],
})
export class ProductModule {}
