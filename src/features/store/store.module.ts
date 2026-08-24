import { Module } from '@nestjs/common';

import { StoreReviewRepository } from '@/features/store/repositories/store-review.repository';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreDetailQueryResolver } from '@/features/store/resolvers/store-detail-query.resolver';
import { StorePickupScheduleQueryResolver } from '@/features/store/resolvers/store-pickup-schedule-query.resolver';
import { StoreQueryResolver } from '@/features/store/resolvers/store-query.resolver';
import { StoreReviewQueryResolver } from '@/features/store/resolvers/store-review-query.resolver';
import { StoreTodayPickupQueryResolver } from '@/features/store/resolvers/store-today-pickup-query.resolver';
import { StoreWishlistMutationResolver } from '@/features/store/resolvers/store-wishlist-mutation.resolver';
import { StoreDetailService } from '@/features/store/services/store-detail.service';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import { StoreReviewService } from '@/features/store/services/store-review.service';
import { StoreTodayPickupService } from '@/features/store/services/store-today-pickup.service';
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
    StoreTodayPickupService,
    StoreTodayPickupQueryResolver,
    StorePickupScheduleService,
    StorePickupScheduleQueryResolver,
  ],
  // StorePickupScheduleService는 주문 생성(order feature)의 픽업 일시 재검증이 소비한다
  exports: [StoreRepository, StorePickupScheduleService],
})
export class StoreModule {}
