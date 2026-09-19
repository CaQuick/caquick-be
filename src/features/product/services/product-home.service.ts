import { Injectable } from '@nestjs/common';

import { RandomService } from '@/common/providers/random.service';
import { parseId } from '@/common/utils/id-parser';
import { DAY_MS } from '@/common/utils/kst-time';
import { anonymizeReviewAuthor } from '@/common/utils/review-author';
import {
  DEFAULT_POPULAR_CAKES_LIMIT,
  DEFAULT_RANDOM_CAKES_LIMIT,
  DEFAULT_SHOWCASE_LIMIT,
  MAX_POPULAR_CAKES_LIMIT,
} from '@/features/product/constants/product-home.constants';
import type { CustomCakeShowcaseInput } from '@/features/product/dto/inputs/custom-cake-showcase.input';
import type { PopularCakesInput } from '@/features/product/dto/inputs/popular-cakes.input';
import type { RandomCakesInput } from '@/features/product/dto/inputs/random-cakes.input';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { ProductCardService } from '@/features/product/services/product-card.service';
import { toHomeBanner } from '@/features/product/services/product-home-mappers.helper';
import type {
  CustomCakeShowcaseItem,
  PopularCakesResult,
  RandomCakesResult,
} from '@/features/product/types/product-home-output.type';
import { ReviewReadRepository, WishlistRepository } from '@/features/review';
import {
  DEFAULT_GLOBAL_RATING_PRIOR,
  RANKING_RECENT_ORDER_DAYS,
  scoreAndSortByPopularity,
  StoreStatsRepository,
} from '@/features/store';

@Injectable()
export class ProductHomeService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly reviewRepo: ReviewReadRepository,
    private readonly stats: StoreStatsRepository,
    private readonly random: RandomService,
    private readonly cards: ProductCardService,
    private readonly wishlists: WishlistRepository,
  ) {}

  /** 인기 매장과 동일 산식(최근 주문·찜·베이지안 평점)을 상품 단위로 적용한다. 배너는 등록분이 없으면 null(fallback 없음 — FE placeholder 처리). */
  async popularCakes(
    input?: PopularCakesInput,
    accountId?: bigint,
  ): Promise<PopularCakesResult> {
    // DTO(@Max)가 1차로 막지만, 직접 호출 경로에서도 "최대 3개" 계약을 지키도록 클램프
    const limit = Math.min(
      input?.limit ?? DEFAULT_POPULAR_CAKES_LIMIT,
      MAX_POPULAR_CAKES_LIMIT,
    );
    const categoryId =
      // GraphQL nullable 필드는 명시적 null도 허용 → null/undefined 모두 '필터 없음'
      input?.categoryId != null ? parseId(input.categoryId) : undefined;
    const regionIds = input?.regionIds?.map((id) => parseId(id));

    const rankedAt = new Date();
    const [candidates, banner] = await Promise.all([
      this.repo.findActiveCakesForRanking({ categoryId, regionIds }),
      this.repo.findHomeBanner({ categoryId, now: rankedAt }),
    ]);
    const bannerOutput = banner ? toHomeBanner(banner) : null;
    if (candidates.length === 0) {
      return { banner: bannerOutput, items: [], rankedAt };
    }

    const productIds = candidates.map((c) => c.id);
    const since = new Date(
      rankedAt.getTime() - RANKING_RECENT_ORDER_DAYS * DAY_MS,
    );

    const [wishlistCounts, reviewStats, orderCounts, globalAverage] =
      await Promise.all([
        this.wishlists.aggregateProductWishlistCounts(productIds),
        this.reviewRepo.aggregateReviewStats('product_id', productIds),
        this.stats.aggregateRecentOrderCounts('product_id', productIds, since),
        this.reviewRepo.globalReviewAverage(),
      ]);
    const prior = globalAverage ?? DEFAULT_GLOBAL_RATING_PRIOR;

    // 점수화·정렬은 인기 매장과 동일 정책(scoreAndSortByPopularity) 단일 소스
    const scored = scoreAndSortByPopularity(
      candidates,
      { wishlistCounts, reviewStats, recentOrderCounts: orderCounts },
      prior,
    );

    const cards = await this.cards.buildCards(
      scored.slice(0, limit).map((entry) => entry.candidate),
      accountId,
      { stats: reviewStats },
    );
    const items = cards.map((product, idx) => ({ rank: idx + 1, product }));

    return { banner: bannerOutput, items, rankedAt };
  }

  /** Before(주문 커스텀 크롭)/After(리뷰 첫 이미지)가 모두 있는 리뷰만 후보 — 대비 연출이 섹션의 본질. */
  async customCakeShowcase(
    input?: CustomCakeShowcaseInput,
  ): Promise<CustomCakeShowcaseItem[]> {
    const limit = input?.limit ?? DEFAULT_SHOWCASE_LIMIT;
    const ranked = await this.reviewRepo.listShowcaseReviewIdsByLikes(limit);
    if (ranked.length === 0) return [];

    const rows = await this.reviewRepo.findShowcaseReviewRowsByIds(
      ranked.map((r) => r.id),
    );
    const rowById = new Map(rows.map((row) => [row.id.toString(), row]));

    const items: CustomCakeShowcaseItem[] = [];
    for (const entry of ranked) {
      const row = rowById.get(entry.id.toString());
      const beforeImageUrl = row?.before_image_url;
      const afterImageUrl = row?.media[0]?.media_url;
      // 후보 SQL이 존재를 보장하지만, 조회 사이의 삭제 경합에 대비해 한 번 더 방어
      if (!row || !beforeImageUrl || !afterImageUrl) continue;

      items.push({
        reviewId: row.id.toString(),
        storeId: row.store_id.toString(),
        rank: items.length + 1,
        authorNickname: anonymizeReviewAuthor(row.account.user_profile)
          .nickname,
        reviewText: row.content,
        likeCount: entry.likeCount,
        beforeImageUrl,
        afterImageUrl,
      });
    }
    return items;
  }

  /** 호출마다 후보 풀에서 무작위 재추출한다(호출 간 중복 허용 — '새로보기 1/3' 카운트는 FE 로컬 상태). */
  async randomCakes(input?: RandomCakesInput): Promise<RandomCakesResult> {
    const limit = input?.limit ?? DEFAULT_RANDOM_CAKES_LIMIT;
    const categoryId =
      // GraphQL nullable 필드는 명시적 null도 허용 → null/undefined 모두 '필터 없음'
      input?.categoryId != null ? parseId(input.categoryId) : undefined;

    const candidateIds = await this.repo.listRandomCakeCandidateIds(categoryId);
    if (candidateIds.length === 0) return { items: [] };

    const pickedIds = this.random.sample(candidateIds, limit);
    const rows = await this.repo.findRandomCakeRows({
      productIds: pickedIds,
      categoryId,
    });
    const rowById = new Map(rows.map((row) => [row.id.toString(), row]));

    // 추출 순서를 유지해 그리드 배치도 무작위가 되게 한다
    const items = pickedIds.flatMap((id) => {
      const row = rowById.get(id.toString());
      const thumbnailUrl = row?.images[0]?.image_url;
      // 후보 조회가 이미지 보유를 보장하지만, 조회 사이의 삭제 경합에 대비해 방어
      if (!thumbnailUrl) return [];
      return [
        { id: id.toString(), storeId: row.store_id.toString(), thumbnailUrl },
      ];
    });

    return { items };
  }
}
