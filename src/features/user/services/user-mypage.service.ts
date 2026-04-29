import { Injectable } from '@nestjs/common';

import { OrderRepository } from '@/features/order/repositories/order.repository';
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
  ) {}

  async getOverview(accountId: bigint): Promise<MyPageOverview> {
    const since = new Date();
    since.setDate(since.getDate() - ONGOING_ORDER_DAYS);

    const [
      customDraftCount,
      wishlistCount,
      myReviewCount,
      ongoingOrders,
      recentViews,
    ] = await Promise.all([
      this.userRepository.countCustomDrafts(accountId),
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
    const wishlistedProductIds =
      await this.userRepository.findWishlistedProductIds({
        accountId,
        productIds: recentViews.map((v) => v.product_id),
      });

    return {
      counts: {
        customDraftCount,
        couponCount: 0, // TODO: 쿠폰 도메인 도입 시 실 구현
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
      recentViewedProducts: recentViews.map((view) => ({
        productId: view.product_id.toString(),
        productName: view.product.name,
        representativeImageUrl: view.product.images[0]?.image_url ?? null,
        salePrice: view.product.sale_price,
        regularPrice: view.product.regular_price,
        storeName: view.product.store.store_name,
        viewedAt: view.viewed_at,
        isWishlisted: wishlistedProductIds.has(view.product_id.toString()),
      })),
    };
  }
}
