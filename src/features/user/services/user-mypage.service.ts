import { Injectable } from '@nestjs/common';

import { OrderRepository } from '@/features/order';
import { ProductCardService } from '@/features/product';
import {
  RecentProductViewRepository,
  ReviewEngagementRepository,
  WishlistRepository,
} from '@/features/review';
import type { MyPageOverview } from '@/features/user/types/user-mypage-output.type';

const ONGOING_ORDER_DAYS = 90;
const ONGOING_ORDER_LIMIT = 5;
const RECENT_VIEW_LIMIT = 20;

@Injectable()
export class UserMypageService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly recentProductViewRepository: RecentProductViewRepository,
    private readonly cards: ProductCardService,
    private readonly wishlists: WishlistRepository,
    private readonly engagement: ReviewEngagementRepository,
  ) {}

  async getOverview(accountId: bigint): Promise<MyPageOverview> {
    const since = new Date();
    since.setDate(since.getDate() - ONGOING_ORDER_DAYS);

    const [wishlistCount, myReviewCount, ongoingOrders, recentViews] =
      await Promise.all([
        this.wishlists.countWishlistItems(accountId),
        this.engagement.countMyReviews(accountId),
        this.orderRepository.findOngoingOrdersByAccount({
          accountId,
          since,
          limit: ONGOING_ORDER_LIMIT,
        }),
        this.recentProductViewRepository.findRecentByAccount(
          accountId,
          RECENT_VIEW_LIMIT,
        ),
      ]);

    const recentCards = await this.cards.buildCards(
      recentViews.map((view) => view.product),
      accountId,
    );

    return {
      counts: {
        wishlistCount,
        myReviewCount,
      },
      ongoingOrders: ongoingOrders.map((order) => {
        const firstItem = order.items[0];
        const firstImage = firstItem?.product?.images?.[0];

        return {
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          status: order.status,
          createdAt: order.created_at,
          pickupAt: order.pickup_at,
          representativeProductName:
            firstItem?.product_name_snapshot ?? '상품 정보 없음',
          representativeProductImageUrl: firstImage?.image_url ?? null,
          totalPrice: order.total_price,
        };
      }),
      recentViewedProducts: recentCards.map((product, idx) => ({
        product,
        viewedAt: recentViews[idx].viewed_at,
      })),
    };
  }
}
