import { ClockService } from '@/common/providers/clock.service';
import { ReviewReadRepository } from '@/features/review';
import { StoreWishlistRepository } from '@/features/review/repositories/store-wishlist.repository';
import { StoreStatsRepository } from '@/features/store/repositories/store-stats.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StorePickupStoresQueryResolver } from '@/features/store/resolvers/store-pickup-stores-query.resolver';
import { StoreCardService } from '@/features/store/services/store-card.service';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StorePickupAvailabilityService } from '@/features/store/services/store-pickup-availability.service';
import { StorePickupStoresService } from '@/features/store/services/store-pickup-stores.service';
import type { PrismaClient } from '@/generated/prisma/client';
import type { JwtUser } from '@/global/auth';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 2026-08-19(수) 16:00 KST 고정, 조회 날짜는 다음 날(목)
const NOW = new Date('2026-08-19T07:00:00.000Z');
const DATE = '2026-08-20';
const DATE_WEEKDAY = new Date(Date.UTC(2026, 7, 20)).getUTCDay();

// 날짜·시간·정렬 분기 세부 검증은 service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
describe('StorePickupStoresQueryResolver (real DB)', () => {
  let resolver: StorePickupStoresQueryResolver;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreCardService,
        ReviewReadRepository,
        StoreStatsRepository,
        StorePickupStoresQueryResolver,
        StorePickupStoresService,
        StorePickupAvailabilityService,
        StoreListingService,
        StoreRepository,
        StoreWishlistRepository,
        ClockService,
        ...bookedQuantityProviders(),
      ],
    });
    resolver = module.get(StorePickupStoresQueryResolver);
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

  async function openStore(name: string) {
    const store = await createStore(prisma, { store_name: name });
    await prisma.storeBusinessHour.create({
      data: {
        store_id: store.id,
        day_of_week: DATE_WEEKDAY,
        is_closed: false,
        open_time: new Date(Date.UTC(1970, 0, 1, 10, 0, 0)),
        close_time: new Date(Date.UTC(1970, 0, 1, 20, 0, 0)),
      },
    });
    return store;
  }

  it('pickupStores: 로그인 사용자의 찜 여부를 채운다', async () => {
    const store = await openStore('리졸버 매장');
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createStoreWishlist(prisma, {
      account_id: account.id,
      store_id: store.id,
    });
    const user = { accountId: account.id.toString() } as JwtUser;

    const result = await resolver.pickupStores(user, {
      date: DATE,
      time: '16:30',
    });

    expect(result.totalCount).toBe(1);
    expect(result.items[0].store).toMatchObject({
      storeName: '리졸버 매장',
      isWishlisted: true,
    });
  });

  it('pickupStores: 비로그인은 isWishlisted=false', async () => {
    await openStore('리졸버 매장');

    const result = await resolver.pickupStores(undefined, { date: DATE });

    expect(result.items[0].store.isWishlisted).toBe(false);
  });
});
