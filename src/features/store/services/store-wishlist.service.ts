import { Injectable, NotFoundException } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { STORE_WISHLIST_ERRORS } from '@/features/store/constants/store-wishlist-error-messages';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';

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
