import { ClockService } from '@/common/providers/clock.service';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StorePickupScheduleQueryResolver } from '@/features/store/resolvers/store-pickup-schedule-query.resolver';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { bookedQuantityProviders } from '@/test/booked-quantity';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createProduct, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 2026-09-16(수) 16:00 KST 고정
const NOW = new Date('2026-09-16T07:00:00.000Z');

// 달력 판정·슬롯 분기 세부 검증은 service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
describe('StorePickupSchedule Query Resolver (real DB)', () => {
  let resolver: StorePickupScheduleQueryResolver;
  let clock: ClockService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StorePickupScheduleQueryResolver,
        StorePickupScheduleService,
        StoreRepository,
        ClockService,
        ...bookedQuantityProviders(),
      ],
    });
    resolver = module.get(StorePickupScheduleQueryResolver);
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

  async function openAllWeek(storeId: bigint): Promise<void> {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      await prisma.storeBusinessHour.create({
        data: {
          store_id: storeId,
          day_of_week: dayOfWeek,
          is_closed: false,
          open_time: new Date(Date.UTC(1970, 0, 1, 10, 0, 0)),
          close_time: new Date(Date.UTC(1970, 0, 1, 20, 0, 0)),
        },
      });
    }
  }

  it('pickupCalendar: ID 문자열을 파싱해 월 달력을 반환한다', async () => {
    const store = await createStore(prisma);
    await openAllWeek(store.id);

    const result = await resolver.pickupCalendar(
      store.id.toString(),
      '2026-09',
    );

    expect(result.yearMonth).toBe('2026-09');
    expect(result.days).toHaveLength(30);
    expect(result.days.find((d) => d.date === '2026-09-18')).toEqual({
      date: '2026-09-18',
      selectable: true,
      reason: null,
    });
  });

  it('pickupTimeSlots: 선택 날짜의 오전/오후 슬롯을 반환한다', async () => {
    const store = await createStore(prisma);
    await openAllWeek(store.id);

    const result = await resolver.pickupTimeSlots(
      store.id.toString(),
      '2026-09-18',
    );

    expect(result.date).toBe('2026-09-18');
    expect(result.morning[0]).toEqual({ time: '10:00', available: true });
    expect(result.afternoon[0]).toEqual({ time: '12:00', available: true });
    expect(result.morning.length + result.afternoon.length).toBe(20);
  });

  it('productId를 파싱해 제작 시간을 반영하고, 빈 문자열은 INVALID_ID·"0"은 버리지 않고 상품 조회에 쓴다', async () => {
    const store = await createStore(prisma, { min_lead_time_minutes: 60 });
    await openAllWeek(store.id);
    const product = await createProduct(prisma, {
      store_id: store.id,
      preparation_time_minutes: 26 * 60,
    });

    const slots = await resolver.pickupTimeSlots(
      store.id.toString(),
      '2026-09-17',
      product.id.toString(),
    );
    expect(slots.afternoon.find((s) => s.time === '17:30')?.available).toBe(
      false,
    );
    expect(slots.afternoon.find((s) => s.time === '18:00')?.available).toBe(
      true,
    );
    const calendar = await resolver.pickupCalendar(
      store.id.toString(),
      '2026-09',
      null,
    );
    expect(calendar.days.find((d) => d.date === '2026-09-17')?.selectable).toBe(
      true,
    );

    expect(() =>
      resolver.pickupCalendar(store.id.toString(), '2026-09', ''),
    ).toThrowDomain('INVALID_ID');
    expect(() =>
      resolver.pickupTimeSlots(store.id.toString(), '2026-09-17', ''),
    ).toThrowDomain('INVALID_ID');
    await expect(
      resolver.pickupCalendar(store.id.toString(), '2026-09', '0'),
    ).rejects.toThrowDomain('PRODUCT_NOT_FOUND');
    await expect(
      resolver.pickupTimeSlots(store.id.toString(), '2026-09-17', '0'),
    ).rejects.toThrowDomain('PRODUCT_NOT_FOUND');
  });
});
