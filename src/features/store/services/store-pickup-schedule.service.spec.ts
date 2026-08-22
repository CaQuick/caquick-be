import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { OrderStatus, PrismaClient, Store } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import type { StorePickupCalendar } from '@/features/store/types/store-pickup-schedule-output.type';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createOrder, createOrderItem, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 2026-09-16(수) 16:00 KST 고정. 요일·자정 경계 계산이 모두 이 시각 기준.
const NOW = new Date('2026-09-16T07:00:00.000Z');

describe('StorePickupScheduleService (real DB)', () => {
  let service: StorePickupScheduleService;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [StorePickupScheduleService, StoreRepository, ClockService],
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

  /** 특정 요일(0=일~6=토) 영업시간 설정. */
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

  /** 전 요일 동일 영업시간 설정. */
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
    await prisma.storeDailyCapacity.create({
      data: { store_id: store.id, capacity_date: dateOnlyUtc, capacity },
    });
  }

  /** 픽업 주문 1건 생성(케이크 quantity개). */
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

  /** 달력에서 특정 날짜 row 조회. */
  function dayOf(calendar: StorePickupCalendar, date: string) {
    const found = calendar.days.find((d) => d.date === date);
    if (!found) throw new Error(`달력에 ${date}가 없음`);
    return found;
  }

  describe('storePickupCalendar', () => {
    it('과거는 PAST, max_days_ahead 초과는 OUT_OF_RANGE, 그 사이 영업일은 선택 가능하다', async () => {
      const store = await createStore(prisma, { max_days_ahead: 7 });
      await openAllWeek(store);

      const calendar = await service.storePickupCalendar(store.id, '2026-09');

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

      const calendar = await service.storePickupCalendar(store.id, '2026-09');

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

      const calendar = await service.storePickupCalendar(store.id, '2026-09');

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

      const calendar = await service.storePickupCalendar(store.id, '2026-09');

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

      const calendar = await service.storePickupCalendar(store.id, '2026-09');

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

      const closedCal = await service.storePickupCalendar(
        soldOutToday.id,
        '2026-09',
      );
      const openCal = await service.storePickupCalendar(
        openToday.id,
        '2026-09',
      );

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

      const calendar = await service.storePickupCalendar(store.id, '2026-09');

      expect(dayOf(calendar, '2026-09-21')).toMatchObject({
        selectable: false,
        reason: 'CAPACITY_FULL',
      });
      expect(dayOf(calendar, '2026-09-20').selectable).toBe(true);
    });

    it('연월 형식 오류는 거절한다', async () => {
      const store = await createStore(prisma);

      await expect(
        service.storePickupCalendar(store.id, '2026-13'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.storePickupCalendar(store.id, '202609'),
      ).rejects.toThrow(BadRequestException);
    });

    it('DB date 표현 범위 밖 연도는 거절한다', async () => {
      const store = await createStore(prisma);

      // 0~99년은 Date.UTC가 1900년대로 매핑해 엉뚱한 세기를 반환하므로 차단
      await expect(
        service.storePickupCalendar(store.id, '0000-01'),
      ).rejects.toThrow(BadRequestException);
      // MySQL DATE 하한(1000-01-01) 미만
      await expect(
        service.storePickupCalendar(store.id, '0999-01'),
      ).rejects.toThrow(BadRequestException);
      // 1000-01은 KST 월 시작 경계(-9h)가 0999-12-31T15:00Z로 DATETIME 하한을 밑돈다
      await expect(
        service.storePickupCalendar(store.id, '1000-01'),
      ).rejects.toThrow(BadRequestException);
      // 9999-12는 익월 상한 계산이 DATE 상한(9999-12-31)을 넘는다
      await expect(
        service.storePickupCalendar(store.id, '9999-12'),
      ).rejects.toThrow(BadRequestException);
    });

    it('없거나 비활성 매장은 NOT_FOUND다', async () => {
      const inactive = await createStore(prisma, { is_active: false });

      await expect(
        service.storePickupCalendar(999999n, '2026-09'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.storePickupCalendar(inactive.id, '2026-09'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('storePickupTimeSlots', () => {
    it('매장 간격·영업시간으로 슬롯을 만들고 당일 리드타임 이전 슬롯은 마감한다', async () => {
      const store = await createStore(prisma, {
        pickup_slot_interval_minutes: 60,
        min_lead_time_minutes: 60,
      });
      await openAllWeek(store, 10, 18);

      const result = await service.storePickupTimeSlots(store.id, '2026-09-16');

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

    it('미래 날짜는 전 슬롯 가용이고 12:00 기준으로 오전/오후를 나눈다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store, 11, 13);

      const result = await service.storePickupTimeSlots(store.id, '2026-09-18');

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

      const result = await service.storePickupTimeSlots(store.id, '2026-09-19');

      expect(result).toEqual({
        date: '2026-09-19',
        morning: [],
        afternoon: [],
      });
    });

    it('capacity 소진 날짜는 전 슬롯 마감으로 표기한다', async () => {
      const store = await createStore(prisma);
      await openAllWeek(store, 10, 12);
      await setCapacity(store, new Date(Date.UTC(2026, 8, 18)), 1);
      await book(store, new Date('2026-09-18T02:00:00.000Z'));

      const result = await service.storePickupTimeSlots(store.id, '2026-09-18');

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

      const result = await service.storePickupTimeSlots(store.id, '2026-09-15');

      expect(result.morning).toEqual([
        { time: '10:00', available: false },
        { time: '10:30', available: false },
      ]);
    });

    it('날짜 형식 오류는 거절한다', async () => {
      const store = await createStore(prisma);

      await expect(
        service.storePickupTimeSlots(store.id, '2026-09-32'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.storePickupTimeSlots(store.id, '20260918'),
      ).rejects.toThrow(BadRequestException);
    });

    it('DB date 표현 범위 밖 연도는 거절한다', async () => {
      const store = await createStore(prisma);

      // 9999-12-31은 익일 상한 계산이 DATE 상한(9999-12-31)을 넘는다
      await expect(
        service.storePickupTimeSlots(store.id, '9999-12-31'),
      ).rejects.toThrow(BadRequestException);
      // 1000-01-01은 KST 자정 경계(-9h)가 DATETIME 하한을 밑돈다
      await expect(
        service.storePickupTimeSlots(store.id, '1000-01-01'),
      ).rejects.toThrow(BadRequestException);
    });

    it('없거나 비활성 매장은 NOT_FOUND다', async () => {
      const inactive = await createStore(prisma, { is_active: false });

      await expect(
        service.storePickupTimeSlots(999999n, '2026-09-18'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.storePickupTimeSlots(inactive.id, '2026-09-18'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
