import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { hasMoreByOffset } from '@/common/utils/pagination';
import {
  DEFAULT_WISHLISTED_STORES_LIMIT,
  WISHLISTED_STORE_IMAGE_LIMIT,
} from '@/features/store/constants/store-wishlist.constants';
import type { MyWishlistedStoresInput } from '@/features/store/dto/inputs/my-wishlisted-stores.input';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreCardService } from '@/features/store/services/store-card.service';
import type { MyWishlistedStoresConnection } from '@/features/store/types/store-wishlist-output.type';

@Injectable()
export class StoreWishlistService {
  constructor(
    private readonly wishlistRepo: StoreWishlistRepository,
    private readonly storeRepo: StoreRepository,
    private readonly cards: StoreCardService,
  ) {}

  async addStoreToWishlist(
    accountId: bigint,
    storeIdStr: string,
  ): Promise<boolean> {
    // 매장 찜은 구매자(USER)만 가능. SELLER/ADMIN 찜이 인기 랭킹을 조작하지 못하도록 차단.
    const isUser = await this.wishlistRepo.isActiveUserAccount(accountId);
    if (!isUser) {
      throw new DomainException('USER_ONLY');
    }
    const storeId = parseId(storeIdStr);
    const exists = await this.storeRepo.existsActiveStore(storeId);
    if (!exists) {
      throw new DomainException('STORE_NOT_FOUND');
    }
    await this.wishlistRepo.upsertStoreWishlist({
      accountId,
      storeId,
      now: new Date(),
    });
    return true;
  }

  /** 계정 타입 제한 없음 — 찜 추가가 USER 전용이므로 타 계정은 자연히 빈 목록. */
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

    // 찜 목록은 시안 기준 이미지 3장(WISHLISTED_STORE_IMAGE_LIMIT)
    const cards = await this.cards.buildCards(
      items.map((row) => row.store),
      accountId,
      { imageLimit: WISHLISTED_STORE_IMAGE_LIMIT },
    );

    return {
      items: cards.map((store, idx) => ({
        store,
        addedAt: items[idx].created_at,
      })),
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
    };
  }

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
