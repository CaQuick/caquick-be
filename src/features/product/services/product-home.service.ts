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
import { ProductReviewRepository } from '@/features/product/repositories/product-review.repository';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import {
  toHomeBanner,
  toPopularCake,
} from '@/features/product/services/product-home-mappers.helper';
import type {
  CustomCakeShowcaseItem,
  PopularCakesResult,
  RandomCakesResult,
} from '@/features/product/types/product-home-output.type';
import {
  DEFAULT_GLOBAL_RATING_PRIOR,
  popularityScore,
  RANKING_RECENT_ORDER_DAYS,
  type StoreMetrics,
} from '@/features/store';

@Injectable()
export class ProductHomeService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly reviewRepo: ProductReviewRepository,
    private readonly random: RandomService,
  ) {}

  /**
   * 홈 '상황별 인기 케이크' 섹션. 인기 매장과 동일 산식(최근 주문·찜·베이지안 평점)을
   * 상품 단위로 적용해 상위 카드를 뽑고, 카테고리 대표 배너를 함께 반환한다.
   * 배너는 등록분이 없으면 null(fallback 없음 — FE placeholder 처리, 정책 확정 사항).
   */
  async popularCakes(input?: PopularCakesInput): Promise<PopularCakesResult> {
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
        this.repo.aggregateProductWishlistCounts(productIds),
        this.repo.aggregateProductReviewStats(productIds),
        this.repo.aggregateProductRecentOrderCounts(productIds, since),
        this.repo.globalReviewAverage(),
      ]);
    const prior = globalAverage ?? DEFAULT_GLOBAL_RATING_PRIOR;

    const scored = candidates.map((candidate) => {
      const review = reviewStats.get(candidate.id);
      const metrics: StoreMetrics = {
        recentOrderCount: orderCounts.get(candidate.id) ?? 0,
        wishlistCount: wishlistCounts.get(candidate.id) ?? 0,
        ratingAverage: review?.average ?? 0,
        reviewCount: review?.count ?? 0,
      };
      return { candidate, metrics, score: popularityScore(metrics, prior) };
    });

    // 점수 desc → 리뷰수 desc → id desc (인기 매장과 동일한 안정적 동점 처리)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.metrics.reviewCount !== a.metrics.reviewCount) {
        return b.metrics.reviewCount - a.metrics.reviewCount;
      }
      return b.candidate.id > a.candidate.id ? 1 : -1;
    });

    const items = scored
      .slice(0, limit)
      .map((entry, idx) => toPopularCake(entry.candidate, idx + 1));

    return { banner: bannerOutput, items, rankedAt };
  }

  /**
   * 홈 '다른 사람들은 이렇게 만들었어요' 제작 후기(전체기간 좋아요순).
   * Before(주문 커스텀 크롭)/After(리뷰 첫 이미지)가 모두 있는 리뷰만 후보.
   * 데이터가 없으면 빈 배열(FE가 빈 상태 문구 처리).
   */
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
      const beforeImageUrl = row?.order_item.free_edits[0]?.crop_image_url;
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

  /**
   * 홈 '렌덤 케이크 둘러보기'. 호출마다 후보 풀에서 무작위 재추출한다
   * (호출 간 중복 허용 — '새로보기 1/3' 카운트는 FE 로컬 상태, 정책 확정 사항).
   */
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
