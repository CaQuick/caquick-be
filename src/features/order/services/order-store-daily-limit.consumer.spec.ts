import { OrderStoreDailyLimitRepository } from '@/features/order/repositories/order-store-daily-limit.repository';
import { OrderStoreDailyLimitConsumer } from '@/features/order/services/order-store-daily-limit.consumer';
import { OutboxDispatcherService } from '@/features/outbox';
import type { OutboxEvent } from '@/features/outbox';
import { StoreCapacityRepository } from '@/features/store/repositories/store-capacity.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  drainOutbox,
  OUTBOX_TEST_IMPORTS,
  outboxTestProviders,
} from '@/test/outbox';

const DATE = new Date('2026-06-01T00:00:00.000Z');
const ACTOR = 7n;

function event(
  payload: OutboxEvent['payload'],
  eventId = '22222222-2222-4222-8222-222222222222',
): OutboxEvent {
  return {
    id: 1n,
    eventId,
    aggregateType: 'store',
    aggregateId: '1',
    eventType: 'store.daily_capacity_changed',
    payload,
    occurredAt: new Date('2026-06-01T00:00:00.000Z'),
    actorAccountId: null,
    clientIp: null,
    userAgent: null,
    attempts: 0,
  };
}

// catalog 설정 변경 → order 복제본(order_store_daily_limit). 복제본이 주문 생성의 유일한 capacity 소스다(D7-a).
describe('OrderStoreDailyLimitConsumer (real DB)', () => {
  let consumer: OrderStoreDailyLimitConsumer;
  let capacities: StoreCapacityRepository;
  let dispatcher: OutboxDispatcherService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      imports: OUTBOX_TEST_IMPORTS,
      providers: [
        OrderStoreDailyLimitConsumer,
        OrderStoreDailyLimitRepository,
        StoreCapacityRepository,
        ...outboxTestProviders(),
      ],
    });
    consumer = module.get(OrderStoreDailyLimitConsumer);
    capacities = module.get(StoreCapacityRepository);
    dispatcher = module.get(OutboxDispatcherService);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function limits() {
    return prisma.orderStoreDailyLimit.findMany({ orderBy: { id: 'asc' } });
  }

  describe('발행 → 소비 통합', () => {
    it('판매자 설정이 복제본에 반영되고, 삭제하면 값이 비워진다(tombstone)', async () => {
      const store = await createStore(prisma);
      const row = await capacities.upsertStoreDailyCapacity({
        storeId: store.id,
        capacityDate: DATE,
        capacity: 30,
        actorAccountId: ACTOR,
      });

      await drainOutbox(dispatcher);
      expect(await limits()).toMatchObject([
        {
          store_id: store.id,
          booking_date: DATE,
          capacity: 30,
          source_updated_at: row.updated_at,
        },
      ]);

      await capacities.softDeleteStoreDailyCapacity({
        capacityId: row.id,
        actorAccountId: ACTOR,
      });
      await drainOutbox(dispatcher);
      // 행은 남고 capacity만 비운다 — 기준점(source_updated_at)이 사라지면 오래된 설정이 되살아난다
      expect(await limits()).toMatchObject([
        { store_id: store.id, booking_date: DATE, capacity: null },
      ]);
    });

    it('날짜 변경은 이전 날짜 복제본을 지우고 새 날짜로 옮긴다', async () => {
      const store = await createStore(prisma);
      const row = await capacities.upsertStoreDailyCapacity({
        storeId: store.id,
        capacityDate: DATE,
        capacity: 30,
        actorAccountId: ACTOR,
      });
      await drainOutbox(dispatcher);

      const moved = new Date('2026-06-02T00:00:00.000Z');
      await capacities.updateStoreDailyCapacity({
        capacityId: row.id,
        capacityDate: moved,
        capacity: 40,
        actorAccountId: ACTOR,
      });
      await drainOutbox(dispatcher);

      // 옛 날짜는 tombstone으로 남고 새 날짜에 설정이 생긴다
      expect(await limits()).toMatchObject([
        { booking_date: DATE, capacity: null },
        { booking_date: moved, capacity: 40 },
      ]);
    });
  });

  describe('멱등·순서', () => {
    it('같은 이벤트 재전달은 복제본을 한 번만 만든다', async () => {
      const payload = {
        storeId: '1',
        capacityDate: '2026-06-01',
        capacity: 10,
        updatedAt: '2026-06-01T00:00:00.000Z',
      };
      await consumer.handle(event(payload));
      await consumer.handle(event(payload));

      expect(await limits()).toMatchObject([{ capacity: 10 }]);
    });

    it('반증: 뒤늦게 도착한 오래된 이벤트는 최신 설정을 덮지 않는다', async () => {
      await consumer.handle(
        event({
          storeId: '1',
          capacityDate: '2026-06-01',
          capacity: 50,
          updatedAt: '2026-06-01T10:00:00.000Z',
        }),
      );
      await consumer.handle(
        event({
          storeId: '1',
          capacityDate: '2026-06-01',
          capacity: 10,
          updatedAt: '2026-06-01T09:00:00.000Z',
        }),
      );

      expect(await limits()).toMatchObject([{ capacity: 50 }]);
    });

    it('반증: 삭제 뒤 도착한 오래된 설정 이벤트는 tombstone에 막혀 제한을 되살리지 못한다', async () => {
      await consumer.handle(
        event({
          storeId: '1',
          capacityDate: '2026-06-01',
          capacity: null,
          updatedAt: '2026-06-01T10:00:00.000Z',
        }),
      );
      await consumer.handle(
        event({
          storeId: '1',
          capacityDate: '2026-06-01',
          capacity: 50,
          updatedAt: '2026-06-01T09:00:00.000Z',
        }),
      );

      expect(await limits()).toMatchObject([{ capacity: null }]);
    });

    it('반증: 오래된 삭제 이벤트는 최신 설정을 지우지 않는다', async () => {
      await consumer.handle(
        event({
          storeId: '1',
          capacityDate: '2026-06-01',
          capacity: 50,
          updatedAt: '2026-06-01T10:00:00.000Z',
        }),
      );
      await consumer.handle(
        event({
          storeId: '1',
          capacityDate: '2026-06-01',
          capacity: null,
          updatedAt: '2026-06-01T09:00:00.000Z',
        }),
      );

      expect(await limits()).toMatchObject([{ capacity: 50 }]);
    });
  });

  it.each([
    [
      'storeId 누락',
      {
        capacityDate: '2026-06-01',
        capacity: 1,
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    [
      '날짜 형식',
      {
        storeId: '1',
        capacityDate: '2026/06/01',
        capacity: 1,
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    [
      'capacity 실수',
      {
        storeId: '1',
        capacityDate: '2026-06-01',
        capacity: 1.5,
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    [
      'updatedAt 비정상',
      {
        storeId: '1',
        capacityDate: '2026-06-01',
        capacity: 1,
        updatedAt: 'not-a-date',
      },
    ],
  ])('반증: 형식이 어긋난 payload(%s)는 던진다', async (_label, payload) => {
    await expect(
      consumer.handle(event(payload as OutboxEvent['payload'])),
    ).rejects.toThrow('payload 형식 오류');
    expect(await limits()).toEqual([]);
  });
});
