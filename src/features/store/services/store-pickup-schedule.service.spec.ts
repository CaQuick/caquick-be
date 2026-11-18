import { ClockService } from '@/common/providers/clock.service';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import type { PickupCalendar } from '@/features/store/types/pickup-schedule-output.type';
import type {
  OrderStatus,
  PrismaClient,
  Store,
} from '@/generated/prisma/client';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createOrder,
  createOrderItem,
  createProduct,
  createStore,
  createStoreDailyCapacity,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 2026-09-16(수) 16:00 KST 고정. 요일·자정 경계 계산이 모두 이 시각 기준.
const NOW = new Date('2026-09-16T07:00:00.000Z');

describe('StorePickupScheduleService (real DB)', () => {
  let service: StorePickupScheduleService;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StorePickupScheduleService,
        StoreRepository,
        ClockService,
        ...bookedQuantityProviders(),
      ],
    });
    service = module.get(StorePickupScheduleService);
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

  async function setBusinessHour(
    store: Store,
    dayOfWeek: number,
    openHour: number,
    closeHour: number,
    isClosed = false,
  ): Promise<void> {
    await prisma.storeBusinessHour.create({
      data: {
        store_id: store.id,
        day_of_week: dayOfWeek,
        is_closed: isClosed,
        open_time: isClosed ? null : new Date(Date.UTC(1970, 0, 1, openHour)),
        close_time: isClosed ? null : new Date(Date.UTC(1970, 0, 1, closeHour)),
      },
    });
  }

  async function openAllWeek(
    store: Store,
    openHour = 10,
    closeHour = 20,
  ): Promise<void> {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      await setBusinessHour(store, dayOfWeek, openHour, closeHour);
    }
  }

  /** 특정 날짜(@db.Date, UTC 자정 표현) 일일 capacity 설정. */
  async function setCapacity(
    store: Store,
    dateOnlyUtc: Date,
    capacity: number,
  ): Promise<void> {
    await createStoreDailyCapacity(prisma, {
      store_id: store.id,
      capacity_date: dateOnlyUtc,
      capacity,
    });
  }

  async function book(
    store: Store,
    pickupAt: Date,
    quantity = 1,
    status: OrderStatus = 'CONFIRMED',
  ): Promise<bigint> {
    const order = await createOrder(prisma, { status, pickup_at: pickupAt });
    await createOrderItem(prisma, {
      order_id: order.id,
      store_id: store.id,
      quantity,
    });
    return order.id;
  }

  function dayOf(calendar: PickupCalendar, date: string) {
    const found = calendar.days.find((d) => d.date === date);
    if (!found) throw new Error(`달력에 ${date}가 없음`);
    return found;
  }

  describe('pickupCalendar', () => {
    it('과거는 PAST, max_days_ahead 초과는 OUT_OF_RANGE, 그 사이 영업일은 선택 가능하다', async () => {
      const store = await createStore(prisma, { max_days_ahead: 7 });
      await openAllWeek(store);

      const calendar = await service.pickupCalendar(store.id, '2026-09');

      expect(calendar.yearMonth).toBe('2026-09');
      expect(calendar.days).toHaveLength(30);
      expect(dayOf(calendar, '2026-09-01')).toMatchObject({
        selectable: false,
        reason: 'PAST',
      });
      expect(dayOf(calendar, '2026-09-15')).toMatchObject({
        selectable: false,
        reason: 'PAST',
      });
      expect(dayOf(calendar, '2026-09-17')).toMatchObject({
        selectable: true,
        reason: null,
      });
      expect(dayOf(calendar, '2026-09-23')).toMatchObject({
        selectable: true,
        reason: null,
      });
      expect(dayOf(calendar, '2026-09-24')).toMatchObject({
        selectable: false,
        reason: 'OUT_OF_RANGE',
      });
      expect(dayOf(calendar, '2026-09-30')).toMatchObject({
        selectable: false,
        reason: 'OUT_OF_RANGE',
      });
    });

    it('특별휴무일은 CLOSED다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store);
      await prisma.storeSpecialClosure.create({
        data: {
          store_id: store.id,
          closure_date: new Date(Date.UTC(2026, 8, 18)),
        },
      });

      const calendar = await service.pickupCalendar(store.id, '2026-09');

      expect(dayOf(calendar, '2026-09-18')).toMatchObject({
        selectable: false,
        reason: 'CLOSED',
      });
      expect(dayOf(calendar, '2026-09-17').selectable).toBe(true);
    });

    it('요일 휴무(is_closed)·영업시간 미설정 요일은 CLOSED다', async () => {
      const store = await createStore(prisma);
      await setBusinessHour(store, 4, 10, 20); // 목요일만 영업
      await setBusinessHour(store, 5, 0, 0, true); // 금요일 휴무 지정

      const calendar = await service.pickupCalendar(store.id, '2026-09');

      expect(dayOf(calendar, '2026-09-17')).toMatchObject({
        selectable: true,
        reason: null,
      }); // 목
      expect(dayOf(calendar, '2026-09-18')).toMatchObject({
        selectable: false,
        reason: 'CLOSED',
      }); // 금(is_closed)
      expect(dayOf(calendar, '2026-09-19')).toMatchObject({
        selectable: false,
        reason: 'CLOSED',
      }); // 토(미설정)
    });

    it('capacity 소진 날짜는 CAPACITY_FULL이고 레코드 없는 날짜는 무제한이다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store);
      await setCapacity(store, new Date(Date.UTC(2026, 8, 17)), 2);
      // 9/17 14:00 KST 픽업 2건 → capacity 2 소진
      await book(store, new Date('2026-09-17T05:00:00.000Z'));
      await book(store, new Date('2026-09-17T05:00:00.000Z'));
      // 9/18은 capacity 레코드 없음 → 예약이 많아도 무제한
      await book(store, new Date('2026-09-18T05:00:00.000Z'), 5);

      const calendar = await service.pickupCalendar(store.id, '2026-09');

      expect(dayOf(calendar, '2026-09-17')).toMatchObject({
        selectable: false,
        reason: 'CAPACITY_FULL',
      });
      expect(dayOf(calendar, '2026-09-18').selectable).toBe(true);
    });

    it('취소·soft-delete 주문은 capacity 점유에서 제외한다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store);
      await setCapacity(store, new Date(Date.UTC(2026, 8, 17)), 1);
      await book(store, new Date('2026-09-17T05:00:00.000Z'), 1, 'CANCELED');
      const deletedOrderId = await book(
        store,
        new Date('2026-09-17T05:00:00.000Z'),
      );
      await prisma.order.update({
        where: { id: deletedOrderId },
        data: { deleted_at: new Date() },
      });

      const calendar = await service.pickupCalendar(store.id, '2026-09');

      expect(dayOf(calendar, '2026-09-17')).toMatchObject({
        selectable: true,
        reason: null,
      });
    });

    it('당일은 리드타임 반영 잔여 슬롯이 없으면 CLOSED다', async () => {
      // 현재 16:00 + 리드 60분 → 마지막 슬롯 15:30이 이미 지나 잔여 없음
      const soldOutToday = await createStore(prisma, {
        min_lead_time_minutes: 60,
      });
      await openAllWeek(soldOutToday, 10, 16);
      const openToday = await createStore(prisma, {
        min_lead_time_minutes: 60,
      });
      await openAllWeek(openToday, 10, 20);

      const closedCal = await service.pickupCalendar(
        soldOutToday.id,
        '2026-09',
      );
      const openCal = await service.pickupCalendar(openToday.id, '2026-09');

      expect(dayOf(closedCal, '2026-09-16')).toMatchObject({
        selectable: false,
        reason: 'CLOSED',
      });
      // 미래일은 리드타임 무관하게 선택 가능
      expect(dayOf(closedCal, '2026-09-17').selectable).toBe(true);
      expect(dayOf(openCal, '2026-09-16').selectable).toBe(true);
    });

    it('KST 자정 경계 픽업 주문은 KST 날짜 기준으로 집계한다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store);
      await setCapacity(store, new Date(Date.UTC(2026, 8, 21)), 1);
      // UTC 9/20 15:30 = KST 9/21 00:30 → 9/21 점유
      await book(store, new Date('2026-09-20T15:30:00.000Z'));

      const calendar = await service.pickupCalendar(store.id, '2026-09');

      expect(dayOf(calendar, '2026-09-21')).toMatchObject({
        selectable: false,
        reason: 'CAPACITY_FULL',
      });
      expect(dayOf(calendar, '2026-09-20').selectable).toBe(true);
    });

    it('연월 형식 오류는 거절한다', async () => {
      const store = await createStore(prisma);

      await expect(
        service.pickupCalendar(store.id, '2026-13'),
      ).rejects.toThrowDomain(400);
      await expect(
        service.pickupCalendar(store.id, '202609'),
      ).rejects.toThrowDomain(400);
    });

    it('DB date 표현 범위 밖 연도는 거절한다', async () => {
      const store = await createStore(prisma);

      // 0~99년은 Date.UTC가 1900년대로 매핑해 엉뚱한 세기를 반환하므로 차단
      await expect(
        service.pickupCalendar(store.id, '0000-01'),
      ).rejects.toThrowDomain(400);
      // MySQL DATE 하한(1000-01-01) 미만
      await expect(
        service.pickupCalendar(store.id, '0999-01'),
      ).rejects.toThrowDomain(400);
      // 1000-01은 KST 월 시작 경계(-9h)가 0999-12-31T15:00Z로 DATETIME 하한을 밑돈다
      await expect(
        service.pickupCalendar(store.id, '1000-01'),
      ).rejects.toThrowDomain(400);
      // 9999-12는 익월 상한 계산이 DATE 상한(9999-12-31)을 넘는다
      await expect(
        service.pickupCalendar(store.id, '9999-12'),
      ).rejects.toThrowDomain(400);
    });

    it('productId를 주면 매장 리드타임과 상품 제작 시간 중 긴 쪽을 하한으로 쓴다', async () => {
      // 리드 60분, 제작 3일 → 현재(9/16 16:00) 기준 9/19 16:00 이전은 마감
      const store = await createStore(prisma, { min_lead_time_minutes: 60 });
      await openAllWeek(store);
      const slow = await createProduct(prisma, {
        store_id: store.id,
        preparation_time_minutes: 3 * 24 * 60,
      });
      const quick = await createProduct(prisma, {
        store_id: store.id,
        preparation_time_minutes: 30,
      });

      const withSlow = await service.pickupCalendar(
        store.id,
        '2026-09',
        slow.id,
      );
      expect(dayOf(withSlow, '2026-09-18')).toMatchObject({
        selectable: false,
        reason: 'CLOSED',
      });
      expect(dayOf(withSlow, '2026-09-19').selectable).toBe(true);

      // 상품이 없거나 제작 시간이 리드타임보다 짧으면 매장 리드타임 그대로다
      for (const productId of [null, quick.id]) {
        const calendar = await service.pickupCalendar(
          store.id,
          '2026-09',
          productId,
        );
        expect(dayOf(calendar, '2026-09-17').selectable).toBe(true);
      }
    });

    it('없거나 비활성 매장은 NOT_FOUND다', async () => {
      const inactive = await createStore(prisma, { is_active: false });

      await expect(
        service.pickupCalendar(999999n, '2026-09'),
      ).rejects.toThrowDomain(404);
      await expect(
        service.pickupCalendar(inactive.id, '2026-09'),
      ).rejects.toThrowDomain(404);
    });
  });

  describe('pickupTimeSlots', () => {
    it('매장 간격·영업시간으로 슬롯을 만들고 당일 리드타임 이전 슬롯은 마감한다', async () => {
      const store = await createStore(prisma, {
        pickup_slot_interval_minutes: 60,
        min_lead_time_minutes: 60,
      });
      await openAllWeek(store, 10, 18);

      const result = await service.pickupTimeSlots(store.id, '2026-09-16');

      // 현재 16:00 + 리드 60분 → 17:00부터 가용
      expect(result.date).toBe('2026-09-16');
      expect(result.morning).toEqual([
        { time: '10:00', available: false },
        { time: '11:00', available: false },
      ]);
      expect(result.afternoon).toEqual([
        { time: '12:00', available: false },
        { time: '13:00', available: false },
        { time: '14:00', available: false },
        { time: '15:00', available: false },
        { time: '16:00', available: false },
        { time: '17:00', available: true },
      ]);
    });

    it('productId를 주면 상품 제작 시간 이전 슬롯을 마감한다', async () => {
      // 리드 60분, 제작 26시간 → 현재(9/16 16:00) 기준 9/17 18:00부터 가능
      const store = await createStore(prisma, { min_lead_time_minutes: 60 });
      await openAllWeek(store, 16, 20);
      const product = await createProduct(prisma, {
        store_id: store.id,
        preparation_time_minutes: 26 * 60,
      });

      const withProduct = await service.pickupTimeSlots(
        store.id,
        '2026-09-17',
        product.id,
      );
      const withoutProduct = await service.pickupTimeSlots(
        store.id,
        '2026-09-17',
      );

      expect(withProduct.afternoon).toEqual([
        { time: '16:00', available: false },
        { time: '16:30', available: false },
        { time: '17:00', available: false },
        { time: '17:30', available: false },
        { time: '18:00', available: true },
        { time: '18:30', available: true },
        { time: '19:00', available: true },
        { time: '19:30', available: true },
      ]);
      expect(withoutProduct.afternoon.every((slot) => slot.available)).toBe(
        true,
      );
    });

    it('미래 날짜는 전 슬롯 가용이고 12:00 기준으로 오전/오후를 나눈다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store, 11, 13);

      const result = await service.pickupTimeSlots(store.id, '2026-09-18');

      expect(result.morning).toEqual([
        { time: '11:00', available: true },
        { time: '11:30', available: true },
      ]);
      expect(result.afternoon).toEqual([
        { time: '12:00', available: true },
        { time: '12:30', available: true },
      ]);
    });

    it('영업하지 않는 날은 빈 배열을 반환한다', async () => {
      const store = await createStore(prisma);
      await setBusinessHour(store, 4, 10, 20); // 목요일만 영업

      const result = await service.pickupTimeSlots(store.id, '2026-09-19');

      expect(result).toEqual({
        date: '2026-09-19',
        morning: [],
        afternoon: [],
      });
    });

    it('특별휴무일도 빈 배열을 반환한다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store);
      await prisma.storeSpecialClosure.create({
        data: {
          store_id: store.id,
          closure_date: new Date(Date.UTC(2026, 8, 18)),
        },
      });

      const result = await service.pickupTimeSlots(store.id, '2026-09-18');

      expect(result).toEqual({
        date: '2026-09-18',
        morning: [],
        afternoon: [],
      });
    });

    it('capacity 소진 날짜는 전 슬롯 마감으로 표기한다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store, 10, 12);
      await setCapacity(store, new Date(Date.UTC(2026, 8, 18)), 1);
      await book(store, new Date('2026-09-18T02:00:00.000Z'));

      const result = await service.pickupTimeSlots(store.id, '2026-09-18');

      expect(result.morning).toEqual([
        { time: '10:00', available: false },
        { time: '10:30', available: false },
        { time: '11:00', available: false },
        { time: '11:30', available: false },
      ]);
      expect(result.afternoon).toEqual([]);
    });

    it('과거 날짜는 전 슬롯 마감이다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store, 10, 11);

      const result = await service.pickupTimeSlots(store.id, '2026-09-15');

      expect(result.morning).toEqual([
        { time: '10:00', available: false },
        { time: '10:30', available: false },
      ]);
    });

    it('날짜 형식 오류는 거절한다', async () => {
      const store = await createStore(prisma);

      await expect(
        service.pickupTimeSlots(store.id, '2026-09-32'),
      ).rejects.toThrowDomain(400);
      await expect(
        service.pickupTimeSlots(store.id, '20260918'),
      ).rejects.toThrowDomain(400);
    });

    it('DB date 표현 범위 밖 연도는 거절한다', async () => {
      const store = await createStore(prisma);

      // 9999-12-31은 익일 상한 계산이 DATE 상한(9999-12-31)을 넘는다
      await expect(
        service.pickupTimeSlots(store.id, '9999-12-31'),
      ).rejects.toThrowDomain(400);
      // 1000-01-01은 KST 자정 경계(-9h)가 DATETIME 하한을 밑돈다
      await expect(
        service.pickupTimeSlots(store.id, '1000-01-01'),
      ).rejects.toThrowDomain(400);
    });

    it('없거나 비활성 매장은 NOT_FOUND다', async () => {
      const inactive = await createStore(prisma, { is_active: false });

      await expect(
        service.pickupTimeSlots(999999n, '2026-09-18'),
      ).rejects.toThrowDomain(404);
      await expect(
        service.pickupTimeSlots(inactive.id, '2026-09-18'),
      ).rejects.toThrowDomain(404);
    });
  });

  describe('productId 검증', () => {
    it('그 매장의 판매 중 상품이 아니면 달력·슬롯 모두 PRODUCT_NOT_FOUND다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store);
      const candidates = [
        await createProduct(prisma), // 다른 매장 상품
        await createProduct(prisma, { store_id: store.id, is_active: false }),
        await createProduct(prisma, {
          store_id: store.id,
          deleted_at: new Date('2026-09-01T00:00:00.000Z'),
        }),
      ];

      for (const product of candidates) {
        await expect(
          service.pickupCalendar(store.id, '2026-09', product.id),
        ).rejects.toThrowDomain('PRODUCT_NOT_FOUND');
        await expect(
          service.pickupTimeSlots(store.id, '2026-09-18', product.id),
        ).rejects.toThrowDomain('PRODUCT_NOT_FOUND');
      }
      await expect(
        service.pickupCalendar(store.id, '2026-09', 999999n),
      ).rejects.toThrowDomain('PRODUCT_NOT_FOUND');
    });

    it('매장이 없으면 상품보다 매장을 먼저 거절한다', async () => {
      const product = await createProduct(prisma);

      await expect(
        service.pickupTimeSlots(999999n, '2026-09-18', product.id),
      ).rejects.toThrowDomain('STORE_NOT_FOUND');
    });
  });

  describe('isPickupSlotAvailable', () => {
    /** 9/18(금) 14:00 KST — 전 요일 10~20시 영업 기준 유효 슬롯. */
    const VALID_PICKUP_AT = new Date('2026-09-18T05:00:00.000Z');

    it('영업시간 내 정렬된 미래 슬롯은 가능하다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store);

      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: VALID_PICKUP_AT,
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(true);
    });

    it('초 이하가 남거나 슬롯 간격에 정렬되지 않은 시각은 불가하다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store);

      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date('2026-09-18T05:00:30.000Z'),
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(false);
      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date('2026-09-18T05:10:00.000Z'),
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(false);
      // 영업시간 밖(21:00 KST)
      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date('2026-09-18T12:00:00.000Z'),
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(false);
    });

    it('당일 리드타임 이전 슬롯·특별휴무일은 불가하다', async () => {
      const store = await createStore(prisma, { min_lead_time_minutes: 60 });
      await openAllWeek(store);
      await prisma.storeSpecialClosure.create({
        data: {
          store_id: store.id,
          closure_date: new Date(Date.UTC(2026, 8, 18)),
        },
      });

      // 오늘(9/16) 16:30 KST — 현재 16:00 + 리드 60분 미달
      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date('2026-09-16T07:30:00.000Z'),
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(false);
      // 오늘 17:00 KST — 리드타임 충족
      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date('2026-09-16T08:00:00.000Z'),
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(true);
      // 휴무일(9/18)
      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: VALID_PICKUP_AT,
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(false);
    });

    it('하루를 넘는 리드타임은 미래 날짜에도 적용된다', async () => {
      // 리드 3일 → 현재(9/16 16:00) 기준 9/19 16:00 이전 슬롯은 전부 마감
      const store = await createStore(prisma, {
        min_lead_time_minutes: 3 * 24 * 60,
      });
      await openAllWeek(store);

      // 9/18 14:00 — 리드타임 미달
      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date('2026-09-18T05:00:00.000Z'),
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(false);
      // 9/19 14:00 — 여전히 미달, 9/19 16:00 — 충족
      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date('2026-09-19T05:00:00.000Z'),
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(false);
      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date('2026-09-19T07:00:00.000Z'),
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(true);

      // 달력도 동일: 리드타임에 완전히 덮인 날은 CLOSED, 부분 가용 날은 선택 가능
      const calendar = await service.pickupCalendar(store.id, '2026-09');
      expect(dayOf(calendar, '2026-09-18')).toMatchObject({
        selectable: false,
        reason: 'CLOSED',
      });
      expect(dayOf(calendar, '2026-09-19').selectable).toBe(true);

      // 슬롯 조회도 9/19 16:00 이전은 마감 표기
      const slots = await service.pickupTimeSlots(store.id, '2026-09-19');
      expect(
        slots.afternoon.find((slot) => slot.time === '15:30')?.available,
      ).toBe(false);
      expect(
        slots.afternoon.find((slot) => slot.time === '16:00')?.available,
      ).toBe(true);
    });

    it('제작 시간이 리드타임보다 길면 제작 시간을 하한으로 쓴다', async () => {
      const store = await createStore(prisma, { min_lead_time_minutes: 60 });
      await openAllWeek(store);
      const at = (iso: string, preparationTimeMinutes: number) =>
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date(iso),
          preparationTimeMinutes,
        });

      // 제작 26시간 → 9/17 18:00 KST부터 가능
      await expect(at('2026-09-17T08:30:00.000Z', 26 * 60)).resolves.toBe(
        false,
      );
      await expect(at('2026-09-17T09:00:00.000Z', 26 * 60)).resolves.toBe(true);
      // 제작 30분은 리드 60분보다 짧아 오늘 16:30은 여전히 불가, 17:00은 가능
      await expect(at('2026-09-16T07:30:00.000Z', 30)).resolves.toBe(false);
      await expect(at('2026-09-16T08:00:00.000Z', 30)).resolves.toBe(true);
    });

    it('없거나 비활성 매장은 불가하다', async () => {
      const inactive = await createStore(prisma, { is_active: false });
      await openAllWeek(inactive);

      await expect(
        service.isPickupSlotAvailable({
          storeId: 999999n,
          pickupAt: VALID_PICKUP_AT,
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(false);
      await expect(
        service.isPickupSlotAvailable({
          storeId: inactive.id,
          pickupAt: VALID_PICKUP_AT,
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(false);
    });
  });
  describe('판매자 픽업 변경(리드타임 생략·숨긴 매장 허용·자기 수량 차감)', () => {
    const ADJUST_NONE = { date: '2026-09-18', quantity: 0 };

    it('리드타임·제작 시간 없이 지난 시각만 막는다(isPickupSlotAvailable SKIP)', async () => {
      const store = await createStore(prisma, {
        min_lead_time_minutes: 3 * 24 * 60,
      });
      await openAllWeek(store);
      const at = (iso: string) =>
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date(iso),
          preparationTimeMinutes: 26 * 60,
          leadTime: 'SKIP',
          storeActiveOnly: false,
        });

      // 오늘(9/16) 16:00 KST 정각 슬롯은 가능, 15:30은 지났다
      await expect(at('2026-09-16T07:00:00.000Z')).resolves.toBe(true);
      await expect(at('2026-09-16T06:30:00.000Z')).resolves.toBe(false);
      // 리드 3일 안쪽(9/17)도 가능 — 반증: APPLY면 불가
      await expect(at('2026-09-17T05:00:00.000Z')).resolves.toBe(true);
      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt: new Date('2026-09-17T05:00:00.000Z'),
          preparationTimeMinutes: 0,
        }),
      ).resolves.toBe(false);
    });

    it('숨긴 매장도 storeActiveOnly false면 판정하고, 기본값은 여전히 불가다', async () => {
      const store = await createStore(prisma, { is_active: false });
      await openAllWeek(store);
      const pickupAt = new Date('2026-09-18T05:00:00.000Z');

      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt,
          preparationTimeMinutes: 0,
          leadTime: 'SKIP',
          storeActiveOnly: false,
        }),
      ).resolves.toBe(true);
      await expect(
        service.isPickupSlotAvailable({
          storeId: store.id,
          pickupAt,
          preparationTimeMinutes: 0,
          leadTime: 'SKIP',
        }),
      ).resolves.toBe(false);
    });

    it('달력은 숨긴 매장도 계산하고 리드타임에 덮인 날도 고를 수 있다', async () => {
      const store = await createStore(prisma, {
        is_active: false,
        min_lead_time_minutes: 3 * 24 * 60,
      });
      await openAllWeek(store);

      const calendar = await service.rescheduleCalendar(
        store.id,
        '2026-09',
        ADJUST_NONE,
      );

      expect(dayOf(calendar, '2026-09-15').reason).toBe('PAST');
      expect(dayOf(calendar, '2026-09-17').selectable).toBe(true);
      const slots = await service.rescheduleTimeSlots(
        store.id,
        '2026-09-16',
        ADJUST_NONE,
      );
      expect(
        slots.afternoon.find((slot) => slot.time === '15:30')?.available,
      ).toBe(false);
      expect(
        slots.afternoon.find((slot) => slot.time === '16:00')?.available,
      ).toBe(true);
    });

    it('옮길 주문의 현재 점유는 그 날짜에서 빼고 센다(다른 날짜는 그대로)', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store);
      await setCapacity(store, new Date(Date.UTC(2026, 8, 18)), 2);
      await setCapacity(store, new Date(Date.UTC(2026, 8, 19)), 2);
      await book(store, new Date('2026-09-18T05:00:00.000Z'), 2);
      await book(store, new Date('2026-09-19T05:00:00.000Z'), 2);
      const adjustment = { date: '2026-09-18', quantity: 2 };

      const calendar = await service.rescheduleCalendar(
        store.id,
        '2026-09',
        adjustment,
      );
      const slots = await service.rescheduleTimeSlots(
        store.id,
        '2026-09-18',
        adjustment,
      );

      expect(dayOf(calendar, '2026-09-18').selectable).toBe(true);
      expect(dayOf(calendar, '2026-09-19').reason).toBe('CAPACITY_FULL');
      expect(slots.afternoon.every((slot) => slot.available)).toBe(true);
      // 반증: 차감이 없으면 같은 날도 소진이다
      expect(
        dayOf(
          await service.rescheduleCalendar(store.id, '2026-09', ADJUST_NONE),
          '2026-09-18',
        ).reason,
      ).toBe('CAPACITY_FULL');
    });

    it('없는 매장과 형식 오류는 거절한다', async () => {
      await expect(
        service.rescheduleCalendar(999999n, '2026-09', ADJUST_NONE),
      ).rejects.toThrowDomain('STORE_NOT_FOUND');
      await expect(
        service.rescheduleCalendar(999999n, '2026-13', ADJUST_NONE),
      ).rejects.toThrowDomain('INVALID_YEAR_MONTH');
      await expect(
        service.rescheduleTimeSlots(999999n, '2026-09-31', ADJUST_NONE),
      ).rejects.toThrowDomain('INVALID_DATE');
    });
  });
});
