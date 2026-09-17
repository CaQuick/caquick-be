import { Injectable } from '@nestjs/common';

import { OrderRepository } from '@/features/order';
import { ProductCardService } from '@/features/product';
import { RecentProductViewRepository } from '@/features/user/repositories/recent-product-view.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import type { MyPageOverview } from '@/features/user/types/user-mypage-output.type';

/** 진행중 주문 조회 기준: 최근 90일 */
const ONGOING_ORDER_DAYS = 90;
/** 진행중 주문 최대 건수 */
const ONGOING_ORDER_LIMIT = 5;
/** 최근 본 상품 최대 건수 */
const RECENT_VIEW_LIMIT = 20;

@Injectable()
export class UserMypageService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly orderRepository: OrderRepository,
    private readonly recentProductViewRepository: RecentProductViewRepository,
    private readonly cards: ProductCardService,
  ) {}

  async getOverview(accountId: bigint): Promise<MyPageOverview> {
    const since = new Date();
    since.setDate(since.getDate() - ONGOING_ORDER_DAYS);

    const [wishlistCount, myReviewCount, ongoingOrders, recentViews] =
      await Promise.all([
        this.userRepository.countWishlistItems(accountId),
        this.userRepository.countMyReviews(accountId),
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

    // N+1 회피: 최근 본 상품 productId 묶음으로 단일 IN 쿼리로 찜 여부 조회
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
