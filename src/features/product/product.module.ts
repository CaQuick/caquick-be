import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { ProductAdminRepository } from '@/features/product/repositories/product-admin.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { AdminContentMutationResolver } from '@/features/product/resolvers/product-admin-banner-mutation.resolver';
import { AdminContentQueryResolver } from '@/features/product/resolvers/product-admin-banner-query.resolver';
import { AdminProductMutationResolver } from '@/features/product/resolvers/product-admin-mutation.resolver';
import { AdminProductQueryResolver } from '@/features/product/resolvers/product-admin-query.resolver';
import { AdminTaxonomyMutationResolver } from '@/features/product/resolvers/product-admin-taxonomy-mutation.resolver';
import { AdminTaxonomyQueryResolver } from '@/features/product/resolvers/product-admin-taxonomy-query.resolver';
import { AdminUploadMutationResolver } from '@/features/product/resolvers/product-admin-upload-mutation.resolver';
import { ProductCategoryQueryResolver } from '@/features/product/resolvers/product-category-query.resolver';
import { ProductDetailQueryResolver } from '@/features/product/resolvers/product-detail-query.resolver';
import { ProductHomeQueryResolver } from '@/features/product/resolvers/product-home-query.resolver';
import { ProductReviewQueryResolver } from '@/features/product/resolvers/product-review-query.resolver';
import { ProductSearchQueryResolver } from '@/features/product/resolvers/product-search-query.resolver';
import { SellerProductMutationResolver } from '@/features/product/resolvers/product-seller-mutation.resolver';
import { SellerProductQueryResolver } from '@/features/product/resolvers/product-seller-query.resolver';
import { SellerUploadMutationResolver } from '@/features/product/resolvers/product-seller-upload-mutation.resolver';
import { ProductStorefrontQueryResolver } from '@/features/product/resolvers/product-storefront-query.resolver';
import { AdminBannerService } from '@/features/product/services/product-admin-banner.service';
import { AdminTaxonomyService } from '@/features/product/services/product-admin-taxonomy.service';
import { AdminUploadService } from '@/features/product/services/product-admin-upload.service';
import { AdminProductService } from '@/features/product/services/product-admin.service';
import { ProductBestSellerService } from '@/features/product/services/product-best-seller.service';
import { ProductCardService } from '@/features/product/services/product-card.service';
import { ProductCategoryService } from '@/features/product/services/product-category.service';
import { ProductDetailService } from '@/features/product/services/product-detail.service';
import { ProductHomeService } from '@/features/product/services/product-home.service';
import { ProductReviewService } from '@/features/product/services/product-review.service';
import { ProductSearchService } from '@/features/product/services/product-search.service';
import { SellerCustomTemplateService } from '@/features/product/services/product-seller-custom-template.service';
import { SellerProductImageService } from '@/features/product/services/product-seller-image.service';
import { SellerProductLifecycleService } from '@/features/product/services/product-seller-lifecycle.service';
import { SellerOptionService } from '@/features/product/services/product-seller-option.service';
import { SellerProductQueryService } from '@/features/product/services/product-seller-query.service';
import { SellerProductTaxonomyService } from '@/features/product/services/product-seller-taxonomy.service';
import { SellerUploadService } from '@/features/product/services/product-seller-upload.service';
import { ProductStorefrontService } from '@/features/product/services/product-storefront.service';
import { ReviewModule } from '@/features/review';
import { StoreModule } from '@/features/store';

@Module({
  imports: [ReviewModule, StoreModule, AuditLogModule, AuthModule],
  providers: [
    ProductRepository,
    ProductCardService,
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
    ProductSearchService,
    ProductSearchQueryResolver,
    // 판매자 상품 관리(상품·이미지·분류·옵션·커스텀 템플릿·업로드 URL) — 상품 도메인이 소유한다
    SellerProductQueryService,
    SellerProductLifecycleService,
    SellerProductImageService,
    SellerProductTaxonomyService,
    SellerOptionService,
    SellerCustomTemplateService,
    SellerUploadService,
    SellerProductQueryResolver,
    SellerProductMutationResolver,
    SellerUploadMutationResolver,
    // 관리자 상품 관리(상품 노출·카테고리·태그·배너·업로드 URL) — 상품 도메인이 소유한다
    ProductAdminRepository,
    AdminProductService,
    AdminTaxonomyService,
    AdminBannerService,
    AdminUploadService,
    AdminProductQueryResolver,
    AdminProductMutationResolver,
    AdminTaxonomyQueryResolver,
    AdminTaxonomyMutationResolver,
    AdminContentQueryResolver,
    AdminContentMutationResolver,
    AdminUploadMutationResolver,
  ],
  // ProductBestSellerService·ProductSearchService는 검색 화면(search feature)이 소비한다
  exports: [
    ProductRepository,
    ProductBestSellerService,
    ProductSearchService,
    ProductCardService,
    ProductAdminRepository,
  ],
})
export class ProductModule {}
