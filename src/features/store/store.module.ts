import { Module } from '@nestjs/common';

import { StoreReviewRepository } from '@/features/store/repositories/store-review.repository';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreDetailQueryResolver } from '@/features/store/resolvers/store-detail-query.resolver';
import { StoreQueryResolver } from '@/features/store/resolvers/store-query.resolver';
import { StoreReviewQueryResolver } from '@/features/store/resolvers/store-review-query.resolver';
import { StoreWishlistMutationResolver } from '@/features/store/resolvers/store-wishlist-mutation.resolver';
import { StoreDetailService } from '@/features/store/services/store-detail.service';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StoreReviewService } from '@/features/store/services/store-review.service';
import { StoreWishlistService } from '@/features/store/services/store-wishlist.service';

@Module({
  providers: [
    StoreRepository,
    StoreReviewRepository,
    StoreWishlistRepository,
    StoreListingService,
    StoreWishlistService,
    StoreDetailService,
    StoreReviewService,
    StoreQueryResolver,
    StoreWishlistMutationResolver,
    StoreDetailQueryResolver,
    StoreReviewQueryResolver,
  ],
  exports: [StoreRepository],
})
export class StoreModule {}
