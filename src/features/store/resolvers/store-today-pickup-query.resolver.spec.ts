import { ClockService } from '@/common/providers/clock.service';
import { ReviewReadRepository } from '@/features/review';
import { StoreStatsRepository } from '@/features/store/repositories/store-stats.repository';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreTodayPickupQueryResolver } from '@/features/store/resolvers/store-today-pickup-query.resolver';
import { StoreCardService } from '@/features/store/services/store-card.service';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StoreTodayPickupService } from '@/features/store/services/store-today-pickup.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 2026-08-19(수) 16:00 KST 고정
const NOW = new Date('2026-08-19T07:00:00.000Z');
const TODAY_WEEKDAY = new Date(Date.UTC(2026, 7, 19)).getUTCDay();

// 슬롯/휴무/capacity 분기 세부 검증은 service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
describe('StoreTodayPickup Query Resolver (real DB)', () => {
  let resolver: StoreTodayPickupQueryResolver;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreCardService,
        ReviewReadRepository,
        StoreStatsRepository,
        StoreTodayPickupQueryResolver,
        StoreTodayPickupService,
        StoreListingService,
        StoreRepository,
        StoreWishlistRepository,
        ClockService,
      ],
    });
    resolver = module.get(StoreTodayPickupQueryResolver);
    clock = module.get(ClockService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.spyOn(clock, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('todayPickupStores: 서비스에 위임해 오늘 픽업 가능 매장을 반환한다', async () => {
    const store = await createStore(prisma, { store_name: '오늘영업매장' });
    await prisma.storeBusinessHour.create({
      data: {
        store_id: store.id,
        day_of_week: TODAY_WEEKDAY,
        is_closed: false,
        open_time: new Date(Date.UTC(1970, 0, 1, 10, 0, 0)),
        close_time: new Date(Date.UTC(1970, 0, 1, 20, 0, 0)),
      },
    });

    const result = await resolver.todayPickupStores(undefined);

    expect(result.items.map((i) => i.store.storeName)).toEqual([
      '오늘영업매장',
    ]);
    expect(result.items[0].slots.length).toBeGreaterThan(0);
    expect(result.asOf).toEqual(NOW);
  });
});
