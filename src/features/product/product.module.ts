import { Module } from '@nestjs/common';

import { ProductRepository } from './repositories/product.repository';
import { ProductDomainService } from './services/product-domain.service';

@Module({
  providers: [ProductRepository, ProductDomainService],
  exports: [ProductRepository, ProductDomainService],
})
export class ProductModule {}
