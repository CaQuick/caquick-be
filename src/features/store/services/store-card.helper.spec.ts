import type { StoreCandidateRow } from '@/features/store/repositories/store.repository';
import {
  fetchStoreCardContext,
  toStoreCardBase,
} from '@/features/store/services/store-card.helper';

// DB 불필요 — 조립 규칙과 비로그인 분기만 검증한다.
describe('store-card helper', () => {
  function row(overrides: Partial<StoreCandidateRow> = {}): StoreCandidateRow {
    return {
      id: 7n,
      store_name: '케이크하우스',
      address_city: null,
      address_neighborhood: null,
      region: null,
      pickup_slot_interval_minutes: 30,
      min_lead_time_minutes: 60,
      max_days_ahead: 30,
      ...overrides,
    };
  }

  describe('toStoreCardBase', () => {
    it('평점을 소수 첫째 자리로 반올림하고 이미지·찜 여부를 매핑한다', () => {
      const result = toStoreCardBase(
        row(),
        { ratingAverage: 4.666, reviewCount: 9 },
        {
          imagesByStore: new Map([[7n, ['a.png', 'b.png']]]),
          wishlistedIds: new Set(['7']),
        },
      );

      expect(result).toEqual({
        id: '7',
        storeName: '케이크하우스',
        ratingAverage: 4.7,
        reviewCount: 9,
        regionLabel: null,
        cakeImageUrls: ['a.png', 'b.png'],
        isWishlisted: true,
      });
    });

    it('이미지·찜 정보가 없으면 빈 배열과 false로 채운다', () => {
      const result = toStoreCardBase(
        row(),
        { ratingAverage: 0, reviewCount: 0 },
        { imagesByStore: new Map(), wishlistedIds: new Set() },
      );

      expect(result.cakeImageUrls).toEqual([]);
      expect(result.isWishlisted).toBe(false);
    });

    it('지역 표기는 시/동 조합을 우선한다', () => {
      const result = toStoreCardBase(
        row({ address_city: '서울', address_neighborhood: '역삼동' }),
        { ratingAverage: 0, reviewCount: 0 },
        { imagesByStore: new Map(), wishlistedIds: new Set() },
      );

      expect(result.regionLabel).toBe('서울 역삼동');
    });
  });

  describe('fetchStoreCardContext', () => {
    const storeRepo = { findStoreCakeImages: jest.fn() };
    const wishlistRepo = { findWishlistedStoreIds: jest.fn() };

    beforeEach(() => {
      jest.clearAllMocks();
      storeRepo.findStoreCakeImages.mockResolvedValue(new Map());
      wishlistRepo.findWishlistedStoreIds.mockResolvedValue(new Set());
    });

    it('로그인 사용자는 찜 조회를 함께 수행한다', async () => {
      await fetchStoreCardContext({
        storeRepo,
        wishlistRepo,
        storeIds: [1n],
        accountId: 5n,
      });

      expect(wishlistRepo.findWishlistedStoreIds).toHaveBeenCalledWith({
        accountId: 5n,
        storeIds: [1n],
      });
    });

    /**
     * 0n 도 유효한 계정 id다. truthy 체크로 분기하면 그 계정이 비로그인으로 떨어져
     * 찜 표시가 사라진다(회귀 사례 다수). undefined 로만 분기하는지 고정한다.
     */
    it('accountId 가 0n 이어도 로그인으로 취급한다', async () => {
      await fetchStoreCardContext({
        storeRepo,
        wishlistRepo,
        storeIds: [1n],
        accountId: 0n,
      });

      expect(wishlistRepo.findWishlistedStoreIds).toHaveBeenCalledWith({
        accountId: 0n,
        storeIds: [1n],
      });
    });

    it('비로그인(undefined)이면 찜 조회를 하지 않고 빈 집합을 준다', async () => {
      const result = await fetchStoreCardContext({
        storeRepo,
        wishlistRepo,
        storeIds: [1n],
      });

      expect(wishlistRepo.findWishlistedStoreIds).not.toHaveBeenCalled();
      expect(result.wishlistedIds.size).toBe(0);
    });

    it('imageLimit 을 그대로 전달한다', async () => {
      await fetchStoreCardContext({
        storeRepo,
        wishlistRepo,
        storeIds: [1n],
        imageLimit: 3,
      });

      expect(storeRepo.findStoreCakeImages).toHaveBeenCalledWith([1n], 3);
    });
  });
});
