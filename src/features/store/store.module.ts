import { Module } from '@nestjs/common';

import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreDetailQueryResolver } from '@/features/store/resolvers/store-detail-query.resolver';
import { StoreQueryResolver } from '@/features/store/resolvers/store-query.resolver';
import { StoreWishlistMutationResolver } from '@/features/store/resolvers/store-wishlist-mutation.resolver';
import { StoreDetailService } from '@/features/store/services/store-detail.service';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StoreWishlistService } from '@/features/store/services/store-wishlist.service';

@Module({
  providers: [
    StoreRepository,
    StoreWishlistRepository,
    StoreListingService,
    StoreWishlistService,
    StoreDetailService,
    StoreQueryResolver,
    StoreWishlistMutationResolver,
    StoreDetailQueryResolver,
  ],
  exports: [StoreRepository],
})
export class StoreModule {}
