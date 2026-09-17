import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { hasMoreByOffset } from '@/common/utils/pagination';
import { ProductCardService, ProductRepository } from '@/features/product';
import { DEFAULT_PAGINATION_LIMIT } from '@/features/user/constants/user.constants';
import type { MyWishlistStoreGroupsInput } from '@/features/user/dto/inputs/my-wishlist-store-groups.input';
import type { MyWishlistInput } from '@/features/user/dto/inputs/my-wishlist.input';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserBaseService } from '@/features/user/services/user-base.service';
import type {
  MyWishlistConnection,
  MyWishlistStoreGroupsConnection,
} from '@/features/user/types/user-wishlist-output.type';

@Injectable()
export class UserWishlistService extends UserBaseService {
  constructor(
    repo: UserRepository,
    private readonly productRepository: ProductRepository,
    private readonly cards: ProductCardService,
  ) {
    super(repo);
  }

  async addToWishlist(
    accountId: bigint,
    productIdStr: string,
  ): Promise<boolean> {
    await this.requireActiveUser(accountId);
    const productId = parseId(productIdStr);

    const exists = await this.productRepository.existsActiveProduct(productId);
    if (!exists) {
      throw new DomainException('PRODUCT_NOT_FOUND');
    }

    await this.repo.upsertWishlistItem({
      accountId,
      productId,
      now: new Date(),
    });
    return true;
  }

  async removeFromWishlist(
    accountId: bigint,
    productIdStr: string,
  ): Promise<boolean> {
    await this.requireActiveUser(accountId);
    const productId = parseId(productIdStr);

    await this.repo.softDeleteWishlistItem({
      accountId,
      productId,
      now: new Date(),
    });
    return true;
  }

  async myWishlist(
    accountId: bigint,
    input?: MyWishlistInput,
  ): Promise<MyWishlistConnection> {
    await this.requireActiveUser(accountId);

    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? DEFAULT_PAGINATION_LIMIT;
    // "0"도 유효 후보로 취급해 truthy 체크가 아닌 null/undefined 체크로 거른다(parseId가 검증).
    const storeId = input?.storeId != null ? parseId(input.storeId) : undefined;

    const { items, totalCount } = await this.repo.findWishlistItems({
      accountId,
      offset,
      limit,
      storeId,
    });

    const cards = await this.cards.buildCards(
      items.map((row) => ({ ...row.product, id: row.product_id })),
      accountId,
    );

    return {
      items: cards.map((product, idx) => ({
        product,
        addedAt: items[idx].created_at,
      })),
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
    };
  }

  /**
   * 찜 상품의 매장별 그룹 목록 (찜 상품 수 desc → 최근 찜 desc → storeId desc).
   * 가시성은 myWishlist와 동일 조건 → totalCount 합이 상품 찜 목록과 일치한다.
   */
  async myWishlistStoreGroups(
    accountId: bigint,
    input?: MyWishlistStoreGroupsInput,
  ): Promise<MyWishlistStoreGroupsConnection> {
    await this.requireActiveUser(accountId);

    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? DEFAULT_PAGINATION_LIMIT;

    const rows = await this.repo.findVisibleWishlistItemsForGrouping(accountId);

    const groups = new Map<
      bigint,
      {
        storeId: bigint;
        storeName: string;
        profileImageUrl: string | null;
        count: number;
        lastAddedAt: Date;
      }
    >();
    for (const row of rows) {
      const store = row.product.store;
      const existing = groups.get(store.id);
      if (existing) {
        existing.count += 1;
        if (row.created_at > existing.lastAddedAt) {
          existing.lastAddedAt = row.created_at;
        }
      } else {
        groups.set(store.id, {
          storeId: store.id,
          storeName: store.store_name,
          profileImageUrl: store.profile_image_url,
          count: 1,
          lastAddedAt: row.created_at,
        });
      }
    }

    const sorted = [...groups.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const timeDiff = b.lastAddedAt.getTime() - a.lastAddedAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      // 같은 밀리초 찜까지 동률이면 storeId desc로 안정적 순서 보장
      return b.storeId > a.storeId ? 1 : -1;
    });

    const totalCount = sorted.length;
    return {
      items: sorted.slice(offset, offset + limit).map((group) => ({
        storeId: group.storeId.toString(),
        storeName: group.storeName,
        profileImageUrl: group.profileImageUrl,
        wishlistedProductCount: group.count,
      })),
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
    };
  }
}
