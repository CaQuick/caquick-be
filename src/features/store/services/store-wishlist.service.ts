import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { STORE_WISHLIST_ERRORS } from '@/features/store/constants/store-wishlist-error-messages';
import {
  DEFAULT_WISHLISTED_STORES_LIMIT,
  WISHLISTED_STORE_IMAGE_LIMIT,
} from '@/features/store/constants/store-wishlist.constants';
import type { MyWishlistedStoresInput } from '@/features/store/dto/inputs/my-wishlisted-stores.input';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { buildRegionLabel } from '@/features/store/services/store-mappers.helper';
import type { MyWishlistedStoresConnection } from '@/features/store/types/store-wishlist-output.type';

@Injectable()
export class StoreWishlistService {
  constructor(
    private readonly wishlistRepo: StoreWishlistRepository,
    private readonly storeRepo: StoreRepository,
  ) {}

  /** 매장 찜 추가 (멱등). 존재하지 않거나 비활성 매장이면 404. */
  async addStoreToWishlist(
    accountId: bigint,
    storeIdStr: string,
  ): Promise<boolean> {
    // 매장 찜은 구매자(USER)만 가능. SELLER/ADMIN 찜이 인기 랭킹을 조작하지 못하도록 차단.
    const isUser = await this.wishlistRepo.isActiveUserAccount(accountId);
    if (!isUser) {
      throw new ForbiddenException(STORE_WISHLIST_ERRORS.USER_ONLY);
    }
    const storeId = parseId(storeIdStr);
    const exists = await this.storeRepo.existsActiveStore(storeId);
    if (!exists) {
      throw new NotFoundException(STORE_WISHLIST_ERRORS.STORE_NOT_FOUND);
    }
    await this.wishlistRepo.upsertStoreWishlist({
      accountId,
      storeId,
      now: new Date(),
    });
    return true;
  }

  /**
   * 내가 찜한 매장 목록 (찜 최신순, offset 페이지네이션).
   * 계정 타입 제한 없음 — 찜 추가가 USER 전용이므로 타 계정은 자연히 빈 목록.
   */
  async myWishlistedStores(
    accountId: bigint,
    input?: MyWishlistedStoresInput,
  ): Promise<MyWishlistedStoresConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? DEFAULT_WISHLISTED_STORES_LIMIT;

    const { items, totalCount } = await this.wishlistRepo.findWishlistedStores({
      accountId,
      offset,
      limit,
    });

    const storeIds = items.map((row) => row.store.id);
    // 평점·이미지는 페이지 매장들만 집계(N+1 회피).
    // 카드 이미지는 인기 매장 카드(PopularStore)와 동일하게 상품 대표 이미지를 쓴다(#216).
    const [reviewStats, cakeImages] = await Promise.all([
      this.storeRepo.aggregateReviewStats(storeIds),
      this.storeRepo.findStoreCakeImages(
        storeIds,
        WISHLISTED_STORE_IMAGE_LIMIT,
      ),
    ]);

    return {
      items: items.map((row) => {
        const stat = reviewStats.get(row.store.id);
        return {
          storeId: row.store.id.toString(),
          storeName: row.store.store_name,
          profileImageUrl: row.store.profile_image_url,
          // 소수 첫째 자리까지(예: 4.666 → 4.7). toPopularStore와 동일 정책.
          ratingAverage: Math.round((stat?.average ?? 0) * 10) / 10,
          reviewCount: stat?.count ?? 0,
          regionLabel: buildRegionLabel(row.store),
          imageUrls: cakeImages.get(row.store.id) ?? [],
          addedAt: row.created_at,
        };
      }),
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }

  /** 매장 찜 해제 (멱등). 없는 항목이어도 true. */
  async removeStoreFromWishlist(
    accountId: bigint,
    storeIdStr: string,
  ): Promise<boolean> {
    const storeId = parseId(storeIdStr);
    await this.wishlistRepo.softDeleteStoreWishlist({
      accountId,
      storeId,
      now: new Date(),
    });
    return true;
  }
}
