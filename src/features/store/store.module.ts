import { Module } from '@nestjs/common';

import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreQueryResolver } from '@/features/store/resolvers/store-query.resolver';
import { StoreListingService } from '@/features/store/services/store-listing.service';

@Module({
  providers: [StoreRepository, StoreListingService, StoreQueryResolver],
  exports: [StoreRepository],
})
export class StoreModule {}
