import { Query, Resolver } from '@nestjs/graphql';

import { ProductCustomCatalogService } from '@/features/product/services/product-custom-catalog.service';
import type { CustomThreeDCatalogOutput } from '@/features/product/types/product-custom-catalog-output.type';

@Resolver('Query')
export class ProductCustomCatalogQueryResolver {
  constructor(private readonly service: ProductCustomCatalogService) {}

  @Query('customThreeDCatalog')
  customThreeDCatalog(): CustomThreeDCatalogOutput {
    return this.service.customThreeDCatalog();
  }
}
