import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import type { RecentViewedProductConnection } from '@/features/user/types/user-mypage-output.type';

/** 계정당 최대 보관 개수 */
const MAX_RECENT_VIEWS = 50;

const RECENT_VIEW_ERRORS = {
  INVALID_LIMIT: '조회 개수는 1~50 사이여야 합니다.',
  INVALID_OFFSET: '오프셋은 0 이상이어야 합니다.',
  PRODUCT_NOT_FOUND: '상품을 찾을 수 없습니다.',
} as const;

@Injectable()
export class UserRecentViewService {
  constructor(
    private readonly recentViewRepo: RecentProductViewRepository,
    private readonly productRepo: ProductRepository,
    private readonly userRepo: UserRepository,
  ) {}

  async list(
    accountId: bigint,
    input?: { offset?: number; limit?: number },
  ): Promise<RecentViewedProductConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 20;

    if (offset < 0) {
      throw new BadRequestException(RECENT_VIEW_ERRORS.INVALID_OFFSET);
    }
    if (limit < 1 || limit > 50) {
      throw new BadRequestException(RECENT_VIEW_ERRORS.INVALID_LIMIT);
    }

    const { items, totalCount } =
      await this.recentViewRepo.findRecentByAccountPaginated({
        accountId,
        offset,
        limit,
      });

    // N+1 회피: 단일 IN 쿼리로 찜 여부 조회
    const wishlistedProductIds = await this.userRepo.findWishlistedProductIds({
      accountId,
      productIds: items.map((v) => v.product_id),
    });

    return {
      items: items.map((view) => ({
        productId: view.product_id.toString(),
        productName: view.product.name,
        representativeImageUrl: view.product.images[0]?.image_url ?? null,
        salePrice: view.product.sale_price,
        regularPrice: view.product.regular_price,
        storeName: view.product.store.store_name,
        viewedAt: view.viewed_at,
        isWishlisted: wishlistedProductIds.has(view.product_id.toString()),
      })),
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }

  async record(accountId: bigint, productIdStr: string): Promise<boolean> {
    const productId = parseId(productIdStr);
    const now = new Date();

    // 상품 존재 확인 (active + 삭제되지 않은 것)
    const product = await this.productRepo.findActiveProduct(productId);
    if (!product) {
      throw new NotFoundException(RECENT_VIEW_ERRORS.PRODUCT_NOT_FOUND);
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
