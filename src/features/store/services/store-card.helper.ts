import { roundRatingAverage } from '@/common/utils/rating';
import type { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import type {
  StoreCandidateRow,
  StoreRepository,
} from '@/features/store/repositories/store.repository';
import { buildRegionLabel } from '@/features/store/services/store-mappers.helper';
import type { StoreMetrics } from '@/features/store/services/store-ranking.helper';

/** 매장 카드 조립에 필요한 페이지 단위 부가 정보. */
export interface StoreCardContext {
  imagesByStore: Map<bigint, string[]>;
  wishlistedIds: Set<string>;
}

/**
 * 페이지 매장들의 대표 케이크 이미지와 찜 여부를 한 번에 가져온다.
 *
 * 인기 매장·검색·오늘 픽업 목록이 같은 블록을 각각 갖고 있었다(주석까지 동일).
 * `accountId`는 **undefined 로만** 비로그인을 분기한다 — 0n도 유효한 계정 id라
 * truthy 체크는 그 계정을 비로그인으로 떨군다(회귀 사례 다수).
 */
export async function fetchStoreCardContext(args: {
  storeRepo: Pick<StoreRepository, 'findStoreCakeImages'>;
  wishlistRepo: Pick<StoreWishlistRepository, 'findWishlistedStoreIds'>;
  storeIds: bigint[];
  accountId?: bigint;
  imageLimit?: number;
}): Promise<StoreCardContext> {
  const [imagesByStore, wishlistedIds] = await Promise.all([
    args.storeRepo.findStoreCakeImages(args.storeIds, args.imageLimit),
    args.accountId !== undefined
      ? args.wishlistRepo.findWishlistedStoreIds({
          accountId: args.accountId,
          storeIds: args.storeIds,
        })
      : Promise.resolve(new Set<string>()),
  ]);

  return { imagesByStore, wishlistedIds };
}

/**
 * 매장 카드의 공통 필드.
 * 화면별 추가 필드(rank·slots·addedAt·profileImageUrl)는 호출부가 얹는다 —
 * profileImageUrl 은 검색·찜 카드에만 있고 후보 row 타입도 그쪽만 갖고 있다.
 */
export interface StoreCardBase {
  id: string;
  storeName: string;
  ratingAverage: number;
  reviewCount: number;
  regionLabel: string | null;
  cakeImageUrls: string[];
  isWishlisted: boolean;
}

/**
 * 공통 카드 필드 조립. 평점 반올림·지역 표기·기본값이 한곳에 모인다.
 * (예전엔 네 서비스가 같은 매핑을 각각 적어 두고 있었다.)
 */
export function toStoreCardBase(
  row: StoreCandidateRow,
  metrics: Pick<StoreMetrics, 'ratingAverage' | 'reviewCount'>,
  context: StoreCardContext,
): StoreCardBase {
  return {
    id: row.id.toString(),
    storeName: row.store_name,
    ratingAverage: roundRatingAverage(metrics.ratingAverage),
    reviewCount: metrics.reviewCount,
    regionLabel: buildRegionLabel(row),
    cakeImageUrls: context.imagesByStore.get(row.id) ?? [],
    isWishlisted: context.wishlistedIds.has(row.id.toString()),
  };
}
