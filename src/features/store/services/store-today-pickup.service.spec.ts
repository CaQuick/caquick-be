import type { PrismaClient, Store } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreListingService } from '@/features/store/services/store-listing.service';
import { StoreTodayPickupService } from '@/features/store/services/store-today-pickup.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 2026-08-19(수) 16:00 KST 고정. 요일·자정 경계 계산이 모두 이 시각 기준.
const NOW = new Date('2026-08-19T07:00:00.000Z');
const TODAY_WEEKDAY = new Date(Date.UTC(2026, 7, 19)).getUTCDay();
const TODAY_DATE_ONLY = new Date(Date.UTC(2026, 7, 19));
/** 오늘 15:00 KST(UTC 06:00) — 픽업 예정 시각으로 사용. */
const TODAY_PICKUP_AT = new Date('2026-08-19T06:00:00.000Z');

describe('StoreTodayPickupService (real DB)', () => {
  let service: StoreTodayPickupService;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreTodayPickupService,
        StoreListingService,
        StoreRepository,
        StoreWishlistRepository,
        ClockService,
      ],
    });
    service = module.get(StoreTodayPickupService);
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

  /** 오늘 요일 영업시간(HH 기준) 설정. */
  async function openToday(
    store: Store,
    openHour: number,
    closeHour: number,
  ): Promise<void> {
    await prisma.storeBusinessHour.create({
      data: {
        store_id: store.id,
        day_of_week: TODAY_WEEKDAY,
        is_closed: false,
        open_time: new Date(Date.UTC(1970, 0, 1, openHour, 0, 0)),
        close_time: new Date(Date.UTC(1970, 0, 1, closeHour, 0, 0)),
      },
    });
  }

  /** 오늘 픽업 유효 주문 n건 생성. */
  async function bookToday(store: Store, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      const order = await createOrder(prisma, {
        status: 'CONFIRMED',
        pickup_at: TODAY_PICKUP_AT,
      });
      await createOrderItem(prisma, {
        order_id: order.id,
        store_id: store.id,
      });
    }
  }

  describe('todayPickupStores', () => {
    it('오늘 영업시간 슬롯을 만들고 리드타임 이전 슬롯은 available=false다', async () => {
      const store = await createStore(prisma, {
        store_name: '헤즈케이크',
        min_lead_time_minutes: 60,
      });
      await openToday(store, 14, 18); // 14:00~18:00, 현재 16:00 + 60분 → 17:00부터 가용

      const result = await service.todayPickupStores();

      expect(result.totalCount).toBe(1);
      expect(result.asOf).toEqual(NOW);
      const [item] = result.items;
      expect(item.storeName).toBe('헤즈케이크');
      expect(item.slots).toEqual([
        { time: '14:00', available: false },
        { time: '14:30', available: false },
        { time: '15:00', available: false },
        { time: '15:30', available: false },
        { time: '16:00', available: false },
        { time: '16:30', available: false },
        { time: '17:00', available: true },
        { time: '17:30', available: true },
      ]);
    });

    it('초가 남은 시각은 다음 분으로 올려 리드타임을 보수적으로 적용한다', async () => {
      // 16:00:30 KST + 리드 60분 → 17:00 슬롯은 59분 30초밖에 안 남아 마감
      jest
        .spyOn(clock, 'now')
        .mockReturnValue(new Date('2026-08-19T07:00:30.000Z'));
      const store = await createStore(prisma, { min_lead_time_minutes: 60 });
      await openToday(store, 16, 18);

      const [item] = (await service.todayPickupStores()).items;

      expect(item.slots).toEqual([
        { time: '16:00', available: false },
        { time: '16:30', available: false },
        { time: '17:00', available: false },
        { time: '17:30', available: true },
      ]);
    });

    it('오늘 요일 휴무·영업시간 미설정·이미 영업 종료된 매장은 제외한다', async () => {
      const closedDay = await createStore(prisma, { store_name: '요일휴무' });
      await prisma.storeBusinessHour.create({
        data: {
          store_id: closedDay.id,
          day_of_week: TODAY_WEEKDAY,
          is_closed: true,
        },
      });
      await createStore(prisma, { store_name: '시간미설정' });
      const ended = await createStore(prisma, { store_name: '영업종료' });
      await openToday(ended, 9, 12); // 현재 16:00 → 가용 슬롯 없음

      const result = await service.todayPickupStores();

      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('오늘 특별휴무인 매장은 제외한다', async () => {
      const store = await createStore(prisma, { store_name: '특별휴무' });
      await openToday(store, 10, 20);
      await prisma.storeSpecialClosure.create({
        data: { store_id: store.id, closure_date: TODAY_DATE_ONLY },
      });

      const result = await service.todayPickupStores();

      expect(result.items).toEqual([]);
    });

    it('일일 capacity가 소진된 매장은 제외한다(CANCELED 주문 미집계)', async () => {
      const full = await createStore(prisma, { store_name: '마감매장' });
      await openToday(full, 10, 20);
      await prisma.storeDailyCapacity.create({
        data: {
          store_id: full.id,
          capacity_date: TODAY_DATE_ONLY,
          capacity: 2,
        },
      });
      await bookToday(full, 2);

      const available = await createStore(prisma, { store_name: '여유매장' });
      await openToday(available, 10, 20);
      await prisma.storeDailyCapacity.create({
        data: {
          store_id: available.id,
          capacity_date: TODAY_DATE_ONLY,
          capacity: 2,
        },
      });
      await bookToday(available, 1);
      // CANCELED 주문은 capacity를 소모하지 않는다
      const canceled = await createOrder(prisma, {
        status: 'CANCELED',
        pickup_at: TODAY_PICKUP_AT,
      });
      await createOrderItem(prisma, {
        order_id: canceled.id,
        store_id: available.id,
      });

      const result = await service.todayPickupStores();

      expect(result.items.map((i) => i.storeName)).toEqual(['여유매장']);
    });

    it('capacity 레코드가 없으면 무제한으로 간주한다', async () => {
      const store = await createStore(prisma, { store_name: '무제한매장' });
      await openToday(store, 10, 20);
      await bookToday(store, 3);

      const result = await service.todayPickupStores();

      expect(result.items.map((i) => i.storeName)).toEqual(['무제한매장']);
    });

    it('인기 매장 랭킹 순으로 정렬한다(찜 많은 매장 우선)', async () => {
      const plain = await createStore(prisma, { store_name: '일반매장' });
      await openToday(plain, 10, 20);
      const popular = await createStore(prisma, { store_name: '인기매장' });
      await openToday(popular, 10, 20);
      for (let i = 0; i < 3; i += 1) {
        const account = await createAccount(prisma, { account_type: 'USER' });
        await prisma.storeWishlistItem.create({
          data: { account_id: account.id, store_id: popular.id },
        });
      }

      const result = await service.todayPickupStores();

      expect(result.items.map((i) => i.storeName)).toEqual([
        '인기매장',
        '일반매장',
      ]);
    });

    it('regionIds 필터와 offset 페이지네이션을 적용한다', async () => {
      const region = await prisma.region.create({
        data: { level: 2, name: '청라동', slug: 'test-cheongna' },
      });
      const inRegion = await createStore(prisma, {
        store_name: '청라매장',
        region_id: region.id,
      });
      await openToday(inRegion, 10, 20);
      const outRegion = await createStore(prisma, { store_name: '타지역매장' });
      await openToday(outRegion, 10, 20);

      const filtered = await service.todayPickupStores({
        regionIds: [region.id.toString()],
      });
      expect(filtered.items.map((i) => i.storeName)).toEqual(['청라매장']);

      const paged = await service.todayPickupStores({ offset: 1, limit: 1 });
      expect(paged.totalCount).toBe(2);
      expect(paged.items).toHaveLength(1);
      expect(paged.hasMore).toBe(false);
    });

    it('로그인 사용자의 찜 여부와 매장 카드 정보를 채운다', async () => {
      const store = await createStore(prisma, {
        store_name: '찜매장',
        address_city: '인천',
        address_neighborhood: '청라동',
      });
      await openToday(store, 10, 20);
      const user = await createAccount(prisma, { account_type: 'USER' });
      await prisma.storeWishlistItem.create({
        data: { account_id: user.id, store_id: store.id },
      });

      const [asUser, asGuest] = [
        await service.todayPickupStores(undefined, user.id),
        await service.todayPickupStores(),
      ];

      expect(asUser.items[0]).toMatchObject({
        storeName: '찜매장',
        regionLabel: '인천 청라동',
        isWishlisted: true,
      });
      expect(asGuest.items[0].isWishlisted).toBe(false);
    });

    it('매장이 없으면 빈 결과를 반환한다', async () => {
      const result = await service.todayPickupStores();

      expect(result).toMatchObject({
        items: [],
        totalCount: 0,
        hasMore: false,
      });
    });
  });
});
