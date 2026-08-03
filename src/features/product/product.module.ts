import { Module } from '@nestjs/common';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductDetailQueryResolver } from '@/features/product/resolvers/product-detail-query.resolver';
import { ProductStorefrontQueryResolver } from '@/features/product/resolvers/product-storefront-query.resolver';
import { ProductDetailService } from '@/features/product/services/product-detail.service';
import { ProductStorefrontService } from '@/features/product/services/product-storefront.service';

@Module({
  providers: [
    ProductRepository,
    ProductDetailService,
    ProductDetailQueryResolver,
    ProductStorefrontService,
    ProductStorefrontQueryResolver,
  ],
  exports: [ProductRepository],
})
export class ProductModule {}
