import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { ReviewReadRepository } from '@/features/review';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { toStoreDetail } from '@/features/store/services/store-detail-mappers.helper';
import type { StoreDetail } from '@/features/store/types/store-detail-output.type';

@Injectable()
export class StoreDetailService {
  constructor(
    private readonly repo: StoreRepository,
    private readonly wishlistRepo: StoreWishlistRepository,
    private readonly reviews: ReviewReadRepository,
  ) {}

  /**
   * 매장 상세 헤더. 비활성/삭제 매장은 NOT_FOUND. 평점·리뷰수는 실시간 집계하고,
   * isWishlisted는 로그인 사용자에 한해 채운다(비로그인 false).
   */
  async storeDetail(
    storeIdRaw: string,
    accountId?: bigint,
  ): Promise<StoreDetail> {
    const storeId = parseId(storeIdRaw);
    const row = await this.repo.findStoreDetailById(storeId);
    if (!row) {
      throw new DomainException('STORE_NOT_FOUND');
    }

    const [reviewStats, wishlistedIds] = await Promise.all([
      this.reviews.aggregateReviewStats('store_id', [storeId]),
      accountId !== undefined
        ? this.wishlistRepo.findWishlistedStoreIds({
            accountId,
            storeIds: [storeId],
          })
        : Promise.resolve(new Set<string>()),
    ]);

    return toStoreDetail(
      row,
      reviewStats.get(storeId),
      wishlistedIds.has(storeId.toString()),
    );
  }
}
