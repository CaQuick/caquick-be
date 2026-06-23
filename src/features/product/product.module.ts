import { Module } from '@nestjs/common';

import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductStorefrontQueryResolver } from '@/features/product/resolvers/product-storefront-query.resolver';
import { ProductStorefrontService } from '@/features/product/services/product-storefront.service';

@Module({
  providers: [
    ProductRepository,
    ProductStorefrontService,
    ProductStorefrontQueryResolver,
  ],
  exports: [ProductRepository],
})
export class ProductModule {}
