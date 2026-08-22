import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StorePickupScheduleQueryResolver } from '@/features/store/resolvers/store-pickup-schedule-query.resolver';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 2026-09-16(수) 16:00 KST 고정
const NOW = new Date('2026-09-16T07:00:00.000Z');

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 달력 판정·슬롯 분기 세부 검증은 service.spec.ts에서 담당.
 */
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

  it('storePickupCalendar: ID 문자열을 파싱해 월 달력을 반환한다', async () => {
    const store = await createStore(prisma);
    await openAllWeek(store.id);

    const result = await resolver.storePickupCalendar(
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

  it('storePickupTimeSlots: 선택 날짜의 오전/오후 슬롯을 반환한다', async () => {
    const store = await createStore(prisma);
    await openAllWeek(store.id);

    const result = await resolver.storePickupTimeSlots(
      store.id.toString(),
      '2026-09-18',
    );

    expect(result.date).toBe('2026-09-18');
    expect(result.morning[0]).toEqual({ time: '10:00', available: true });
    expect(result.afternoon[0]).toEqual({ time: '12:00', available: true });
    expect(result.morning.length + result.afternoon.length).toBe(20);
  });
});
