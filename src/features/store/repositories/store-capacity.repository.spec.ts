import { StoreCapacityRepository } from '@/features/store/repositories/store-capacity.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

// 일일 capacity write는 변경 이벤트(StoreDailyCapacityChanged)를 같은 tx에 적재해야 order 복제본이 따라온다(D7-a).
describe('StoreCapacityRepository (real DB)', () => {
  let repo: StoreCapacityRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [StoreCapacityRepository, ...outboxPublisherProviders()],
    });
    repo = module.get(StoreCapacityRepository);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  const DATE = new Date('2026-06-01T00:00:00.000Z');
  const ACTOR = 7n;

  async function events() {
    return prisma.outbox.findMany({ orderBy: { id: 'asc' } });
  }

  it('upsert는 설정을 만들고 변경 이벤트를 같은 tx에 적재한다', async () => {
    const store = await createStore(prisma);

    const row = await repo.upsertStoreDailyCapacity({
      storeId: store.id,
      capacityDate: DATE,
      capacity: 100,
      actorAccountId: ACTOR,
    });

    expect(row.capacity).toBe(100);
    const [event] = await events();
    expect(event).toMatchObject({
      aggregate_type: 'store',
      aggregate_id: store.id.toString(),
      event_type: 'store.daily_capacity_changed',
      actor_account_id: ACTOR,
    });
    expect(event.payload_json).toEqual({
      storeId: store.id.toString(),
      capacityDate: '2026-06-01',
      capacity: 100,
      updatedAt: row.updated_at.toISOString(),
    });
  });

  it('upsert는 soft-delete된 설정을 복구하고(같은 row) 변경 이벤트를 낸다', async () => {
    const store = await createStore(prisma);
    const seed = await prisma.storeDailyCapacity.create({
      data: {
        store_id: store.id,
        capacity_date: DATE,
        capacity: 50,
        deleted_at: new Date(),
      },
    });

    const row = await repo.upsertStoreDailyCapacity({
      storeId: store.id,
      capacityDate: DATE,
      capacity: 100,
      actorAccountId: ACTOR,
    });

    expect(row.id).toBe(seed.id);
    expect(row.deleted_at).toBeNull();
    expect(await events()).toHaveLength(1);
  });

  it('update가 날짜를 바꾸면 이전 날짜 해제 + 새 날짜 설정으로 이벤트 2건을 낸다', async () => {
    const store = await createStore(prisma);
    const seed = await repo.upsertStoreDailyCapacity({
      storeId: store.id,
      capacityDate: DATE,
      capacity: 50,
      actorAccountId: ACTOR,
    });

    await repo.updateStoreDailyCapacity({
      capacityId: seed.id,
      capacityDate: new Date('2026-06-02T00:00:00.000Z'),
      capacity: 200,
      actorAccountId: ACTOR,
    });

    const payloads = (await events()).map((e) => e.payload_json);
    expect(payloads).toMatchObject([
      { capacityDate: '2026-06-01', capacity: 50 },
      { capacityDate: '2026-06-01', capacity: null },
      { capacityDate: '2026-06-02', capacity: 200 },
    ]);
  });

  it('날짜가 그대로면 해제 이벤트 없이 설정 이벤트만 낸다', async () => {
    const store = await createStore(prisma);
    const seed = await repo.upsertStoreDailyCapacity({
      storeId: store.id,
      capacityDate: DATE,
      capacity: 50,
      actorAccountId: ACTOR,
    });

    await repo.updateStoreDailyCapacity({
      capacityId: seed.id,
      capacityDate: DATE,
      capacity: 200,
      actorAccountId: ACTOR,
    });

    const payloads = (await events()).map((e) => e.payload_json);
    expect(payloads).toMatchObject([
      { capacityDate: '2026-06-01', capacity: 50 },
      { capacityDate: '2026-06-01', capacity: 200 },
    ]);
  });

  it('softDelete는 설정을 지우고 capacity null 이벤트를 낸다', async () => {
    const store = await createStore(prisma);
    const seed = await repo.upsertStoreDailyCapacity({
      storeId: store.id,
      capacityDate: DATE,
      capacity: 50,
      actorAccountId: ACTOR,
    });

    await repo.softDeleteStoreDailyCapacity({
      capacityId: seed.id,
      actorAccountId: ACTOR,
    });

    const after = await prisma.storeDailyCapacity.findUniqueOrThrow({
      where: { id: seed.id },
    });
    expect(after.deleted_at).not.toBeNull();
    expect((await events()).at(-1)?.payload_json).toMatchObject({
      capacityDate: '2026-06-01',
      capacity: null,
    });
  });
});
