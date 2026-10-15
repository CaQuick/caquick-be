import { ClockService } from '@/common/providers/clock.service';
import { ReviewReadRepository } from '@/features/review';
import { StoreWishlistRepository } from '@/features/review/repositories/store-wishlist.repository';
import { StoreStatsRepository } from '@/features/store/repositories/store-stats.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreCardService } from '@/features/store/services/store-card.service';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StorePickupAvailabilityService } from '@/features/store/services/store-pickup-availability.service';
import { StorePickupStoresService } from '@/features/store/services/store-pickup-stores.service';
import type { PrismaClient, Store } from '@/generated/prisma/client';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createOrder,
  createOrderItem,
  createRegion,
  createStore,
  createStoreDailyCapacity,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 2026-08-19(수) 16:00 KST 고정. 조회 날짜는 기본으로 다음 날(목).
const NOW = new Date('2026-08-19T07:00:00.000Z');
const TODAY = '2026-08-19';
const DATE = '2026-08-20';
const DATE_WEEKDAY = new Date(Date.UTC(2026, 7, 20)).getUTCDay();
const DATE_ONLY = new Date(Date.UTC(2026, 7, 20));
/** 조회 날짜 15:00 KST(UTC 06:00) — 예약 픽업 시각. */
const DATE_PICKUP_AT = new Date('2026-08-20T06:00:00.000Z');

describe('StorePickupStoresService (real DB)', () => {
  let service: StorePickupStoresService;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreCardService,
        ReviewReadRepository,
        StoreStatsRepository,
        StorePickupStoresService,
        StorePickupAvailabilityService,
        StoreListingService,
        StoreRepository,
        StoreWishlistRepository,
        ClockService,
        ...bookedQuantityProviders(),
      ],
    });
    service = module.get(StorePickupStoresService);
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

  async function openOn(
    store: Store,
    openHour: number,
    closeHour: number,
    weekday = DATE_WEEKDAY,
  ): Promise<void> {
    await prisma.storeBusinessHour.create({
      data: {
        store_id: store.id,
        day_of_week: weekday,
        is_closed: false,
        open_time: new Date(Date.UTC(1970, 0, 1, openHour, 0, 0)),
        close_time: new Date(Date.UTC(1970, 0, 1, closeHour, 0, 0)),
      },
    });
  }

  async function openStore(name: string, overrides = {}): Promise<Store> {
    const store = await createStore(prisma, { store_name: name, ...overrides });
    await openOn(store, 10, 20);
    return store;
  }

  async function names(
    input: Partial<Parameters<typeof service.pickupStores>[0]> = {},
  ): Promise<string[]> {
    const result = await service.pickupStores({ date: DATE, ...input });
    return result.items.map((i) => i.store.storeName);
  }

  describe('날짜 판정', () => {
    it('그날 요일 휴무·영업시간 미설정·특별휴무 매장은 제외한다', async () => {
      await openStore('영업');
      const closedDay = await createStore(prisma, { store_name: '요일휴무' });
      await prisma.storeBusinessHour.create({
        data: {
          store_id: closedDay.id,
          day_of_week: DATE_WEEKDAY,
          is_closed: true,
        },
      });
      await createStore(prisma, { store_name: '시간미설정' });
      const otherDay = await createStore(prisma, { store_name: '다른요일만' });
      await openOn(otherDay, 10, 20, (DATE_WEEKDAY + 1) % 7);
      const closure = await openStore('특별휴무');
      await prisma.storeSpecialClosure.create({
        data: { store_id: closure.id, closure_date: DATE_ONLY },
      });

      expect(await names()).toEqual(['영업']);
    });

    it('그날 capacity가 소진된 매장은 제외한다', async () => {
      const full = await openStore('마감');
      await createStoreDailyCapacity(prisma, {
        store_id: full.id,
        capacity_date: DATE_ONLY,
        capacity: 2,
      });
      const order = await createOrder(prisma, {
        status: 'CONFIRMED',
        pickup_at: DATE_PICKUP_AT,
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: full.id,
        quantity: 2,
      });
      await openStore('여유');

      expect(await names()).toEqual(['여유']);
    });

    it('예약 가능 기간(max_days_ahead)을 넘거나 리드타임으로 마감된 매장은 제외한다', async () => {
      await openStore('기간내', { max_days_ahead: 1 });
      await openStore('기간초과', { max_days_ahead: 0 });
      // 16:00 + 2일 리드타임 → 다음 날 영업시간 전체가 마감
      await openStore('리드타임', { min_lead_time_minutes: 2 * 24 * 60 });

      expect(await names()).toEqual(['기간내']);
    });

    it('오늘 날짜는 지금 이후 예약 가능한 슬롯이 있는 매장만 남긴다', async () => {
      const today = new Date(Date.UTC(2026, 7, 19)).getUTCDay();
      const open = await createStore(prisma, { store_name: '저녁까지' });
      await openOn(open, 10, 20, today);
      const ended = await createStore(prisma, { store_name: '영업종료' });
      await openOn(ended, 9, 12, today);

      expect(await names({ date: TODAY })).toEqual(['저녁까지']);
    });

    it('정책 상한(365일)을 넘는 날짜는 조회 없이 빈 결과다', async () => {
      await openStore('매장', { max_days_ahead: 365 });

      expect(await service.pickupStores({ date: '2027-08-20' })).toEqual({
        items: [],
        totalCount: 0,
        hasMore: false,
      });
    });
  });

  describe('시간 필터', () => {
    it('그 시각 슬롯이 예약 가능한 매장만 남긴다', async () => {
      await openStore('오후', {});
      const morning = await createStore(prisma, { store_name: '오전만' });
      await openOn(morning, 9, 12);
      const hourly = await createStore(prisma, {
        store_name: '1시간간격',
        pickup_slot_interval_minutes: 60,
      });
      await openOn(hourly, 10, 20);

      expect(await names({ time: '16:30' })).toEqual(['오후']);
      expect(await names({ time: '16:00' })).toEqual(['1시간간격', '오후']);
      expect(await names({ time: '16:15' })).toEqual([]);
    });

    it('리드타임으로 마감된 슬롯은 통과하지 않는다', async () => {
      const today = new Date(Date.UTC(2026, 7, 19)).getUTCDay();
      const store = await createStore(prisma, {
        store_name: '오늘',
        min_lead_time_minutes: 60,
      });
      await openOn(store, 10, 20, today);

      // 16:00 + 60분 → 16:30은 마감, 17:00부터 가능
      expect(await names({ date: TODAY, time: '16:30' })).toEqual([]);
      expect(await names({ date: TODAY, time: '17:00' })).toEqual(['오늘']);
    });

    it('time을 생략하거나 null로 넘기면 시간 조건이 없다', async () => {
      await openStore('매장');

      for (const time of [undefined, null]) {
        expect(await names({ time })).toEqual(['매장']);
      }
    });
  });

  describe('입력 검증', () => {
    it.each([
      ['2026-8-20', 'INVALID_DATE'],
      ['2026-02-30', 'INVALID_DATE'],
      ['', 'INVALID_DATE'],
      ['2026-08-18', 'PICKUP_DATE_PAST'],
    ])('date=%p → %s', async (date, code) => {
      await expect(service.pickupStores({ date })).rejects.toThrowDomain(code);
    });

    it.each(['4:30', '24:00', '16:60', '16:30:00', ''])(
      'time=%p → INVALID_TIME_VALUE',
      async (time) => {
        await expect(
          service.pickupStores({ date: DATE, time }),
        ).rejects.toThrowDomain('INVALID_TIME_VALUE');
      },
    );
  });

  describe('정렬·페이지·응답', () => {
    it('sort를 반영하고 생략하면 인기순이다', async () => {
      const old = await openStore('오래됨');
      await openStore('최신');
      await prisma.store.update({
        where: { id: old.id },
        data: { created_at: new Date('2026-01-01T00:00:00Z') },
      });
      await createStoreWishlist(prisma, { store_id: old.id });

      expect(await names({ sort: 'LATEST' })).toEqual(['최신', '오래됨']);
      expect(await names()).toEqual(['오래됨', '최신']);
    });

    it('regionIds·offset/limit·totalCount·hasMore를 적용한다', async () => {
      const region = await createRegion(prisma, { level: 2, slug: 'sgg-p' });
      for (let i = 0; i < 3; i += 1) {
        await openStore(`지역${i}`, { region_id: region.id });
      }
      await openStore('타지역');

      const page = await service.pickupStores({
        date: DATE,
        regionIds: [region.id.toString()],
        sort: 'LATEST',
        offset: 1,
        limit: 1,
      });

      expect(page.totalCount).toBe(3);
      expect(page.hasMore).toBe(true);
      expect(page.items.map((i) => i.store.storeName)).toEqual(['지역1']);
    });

    it('항목에 매장 좌표를 싣고 미설정이면 null이다', async () => {
      await openStore('좌표', { latitude: 37.5735, longitude: 126.986 });
      await openStore('좌표없음');

      const { items } = await service.pickupStores({
        date: DATE,
        sort: 'LATEST',
      });

      expect(items).toEqual([
        expect.objectContaining({ latitude: null, longitude: null }),
        expect.objectContaining({ latitude: 37.5735, longitude: 126.986 }),
      ]);
    });
  });
});
