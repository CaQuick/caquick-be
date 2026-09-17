import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { hasMoreByOffset } from '@/common/utils/pagination';
import { ProductCardService, ProductRepository } from '@/features/product';
import type { MyRecentViewedProductsInput } from '@/features/user/dto/inputs/my-recent-viewed-products.input';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import type { RecentViewedProductConnection } from '@/features/user/types/user-mypage-output.type';

/** 계정당 최대 보관 개수 */
const MAX_RECENT_VIEWS = 50;

@Injectable()
export class UserRecentViewService {
  constructor(
    private readonly recentViewRepo: RecentProductViewRepository,
    private readonly productRepo: ProductRepository,
    private readonly userRepo: UserRepository,
    private readonly cards: ProductCardService,
  ) {}

  async list(
    accountId: bigint,
    input?: MyRecentViewedProductsInput,
  ): Promise<RecentViewedProductConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 20;

    const { items, totalCount } =
      await this.recentViewRepo.findRecentByAccountPaginated({
        accountId,
        offset,
        limit,
      });

    const cards = await this.cards.buildCards(
      items.map((view) => view.product),
      accountId,
    );

    return {
      items: cards.map((product, idx) => ({
        product,
        viewedAt: items[idx].viewed_at,
      })),
      totalCount,
      hasMore: hasMoreByOffset(offset, limit, totalCount),
    };
  }

  async record(accountId: bigint, productIdStr: string): Promise<boolean> {
    const productId = parseId(productIdStr);
    const now = new Date();

    // 상품 존재 확인 (active + 삭제되지 않은 것)
    const product = await this.productRepo.findActiveProduct(productId);
    if (!product) {
      throw new DomainException('PRODUCT_NOT_FOUND');
    }

    await this.recentViewRepo.upsertView({ accountId, productId, now });

    // 초과분 정리
    await this.recentViewRepo.deleteOldestOverLimit({
      accountId,
      maxCount: MAX_RECENT_VIEWS,
      now,
    });

    return true;
  }

  async deleteOne(accountId: bigint, productIdStr: string): Promise<boolean> {
    const productId = parseId(productIdStr);
    return this.recentViewRepo.softDeleteByProduct({
      accountId,
      productId,
      now: new Date(),
    });
  }

  async clearAll(accountId: bigint): Promise<boolean> {
    const count = await this.recentViewRepo.softDeleteAllByAccount({
      accountId,
      now: new Date(),
    });
    return count >= 0;
  }
}
