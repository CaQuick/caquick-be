import { Logger } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { SETTLEMENT_CREATED } from '@/features/order/events/settlement-created.event';
import { SettlementRepository } from '@/features/order/repositories/settlement.repository';
import {
  SETTLEMENT_BATCH_SIZE,
  SETTLEMENT_MAX_PER_RUN,
  SettlementScheduler,
} from '@/features/order/services/order-settlement.scheduler';
import { OutboxPublisher } from '@/features/outbox';
import type { PrismaClient } from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createFinalizedOrder,
  createOrder,
  createOrderItem,
  createPayment,
  createSettlement,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

// 2026-11-16(월) 05:00 KST — 지난주는 11-09(월) ~ 11-15(일)
const MONDAY_5AM = new Date('2026-11-15T20:00:00.000Z');
const SUNDAY_LAST_MS = new Date('2026-11-15T14:59:59.999Z');
const MONDAY_0AM = new Date('2026-11-15T15:00:00.000Z');
const WEEK_MS = 7 * 24 * 60 * 60_000;
const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

// 주간 정산: KST 주 경계, 매장별 묶음·합계, 재실행 멱등, 정산 행과 outbox의 같은 tx, 묵은 주문, soft-delete 제외, 후보 배치·상한·키셋, 역할 게이트.
describe('SettlementScheduler (real DB)', () => {
  let scheduler: SettlementScheduler;
  let publisher: OutboxPublisher;
  let repository: SettlementRepository;
  let prisma: PrismaClient;
  let now = MONDAY_5AM;
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };
  const savedRole = process.env.APP_ROLE;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SettlementScheduler,
        SettlementRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: ClockService, useValue: { now: () => now } },
        { provide: AlertService, useValue: alerts },
        ...outboxPublisherProviders({ clock: true }),
      ],
    });
    scheduler = module.get(SettlementScheduler);
    publisher = module.get(OutboxPublisher);
    repository = module.get(SettlementRepository);
    prisma = p;
  });

  afterAll(async () => {
    if (savedRole === undefined) delete process.env.APP_ROLE;
    else process.env.APP_ROLE = savedRole;
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    process.env.APP_ROLE = 'worker';
    now = MONDAY_5AM;
    alerts.notify.mockClear();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const settlementIdOf = async (orderId: bigint) =>
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } }))
      .settlement_id;
  const createdEvents = () =>
    prisma.outbox.findMany({
      where: { event_type: SETTLEMENT_CREATED },
      orderBy: { id: 'asc' },
    });
  const settledStoreIds = async () =>
    (await prisma.settlement.findMany({ orderBy: { store_id: 'asc' } })).map(
      (s) => s.store_id,
    );
  /** 매장마다 지난주 확정 주문 1건. 매장 id 오름차순. */
  async function pendingStores(count: number): Promise<bigint[]> {
    const ids: bigint[] = [];
    for (let i = 0; i < count; i++) {
      const store = await createStore(prisma);
      await createFinalizedOrder(prisma, {
        store_id: store.id,
        finalized_at: new Date('2026-11-10T00:00:00.000Z'),
      });
      ids.push(store.id);
    }
    return ids;
  }
  const silenceWarn = () =>
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  it('지난주(월~일 KST)에 확정된 주문을 매장별로 묶고 합계·기간·매장명과 settlement.created를 남긴다', async () => {
    const store = await createStore(prisma);
    const first = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-11-09T01:00:00.000Z'),
      base_amount: 30_000,
      commission_rate_bps: 555,
      store_name_snapshot: '옛 이름',
    });
    // 구매자 사정 취소의 남은 금액도 정산에 들어간다
    const second = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-11-12T05:00:00.000Z'),
      base_amount: 10_001,
      commission_rate_bps: 555,
      status: 'CANCELED',
      store_name_snapshot: '해즈 케이크',
    });

    await expect(scheduler.settleLastWeek()).resolves.toBe(1);

    const [settlement] = await prisma.settlement.findMany();
    // 30000×5.55% = 1665, 10001×5.55% = 555.05 → 555
    expect(settlement).toMatchObject({
      store_id: store.id,
      store_name_snapshot: '해즈 케이크',
      period_start: dateOnly('2026-11-09'),
      period_end: dateOnly('2026-11-15'),
      order_count: 2,
      settlement_base_amount: 40_001,
      commission_amount: 2_220,
      payout_amount: 37_781,
      status: 'PENDING',
    });
    expect(await settlementIdOf(first.id)).toBe(settlement.id);
    expect(await settlementIdOf(second.id)).toBe(settlement.id);
    const events = await createdEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregate_type: 'settlement',
      aggregate_id: settlement.id.toString(),
      occurred_at: MONDAY_5AM,
      payload_json: {
        settlementId: settlement.id.toString(),
        storeId: store.id.toString(),
        storeName: '해즈 케이크',
        periodStart: '2026-11-09',
        periodEnd: '2026-11-15',
        orderCount: 2,
        settlementBaseAmount: 40_001,
        commissionAmount: 2_220,
        payoutAmount: 37_781,
      },
    });
  });

  it('일요일 23:59:59.999에 확정된 주문은 지난주에, 월요일 00:00에 확정된 주문은 다음 주에 들어간다', async () => {
    const store = await createStore(prisma);
    const sunday = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: SUNDAY_LAST_MS,
    });
    const monday = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: MONDAY_0AM,
    });

    await scheduler.settleLastWeek();

    expect(await settlementIdOf(sunday.id)).not.toBeNull();
    expect(await settlementIdOf(monday.id)).toBeNull();

    now = new Date(MONDAY_5AM.getTime() + WEEK_MS);
    await scheduler.settleLastWeek();

    const next = await prisma.settlement.findFirstOrThrow({
      where: { period_start: dateOnly('2026-11-16') },
    });
    expect(await settlementIdOf(monday.id)).toBe(next.id);
  });

  it('실행 시각이 일요일 23:59:59.999면 그 전주(11-02~11-08)를 정산하고 이번 주 확정분은 남긴다', async () => {
    now = SUNDAY_LAST_MS;
    const store = await createStore(prisma);
    const before = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-11-08T14:59:59.999Z'),
    });
    const thisWeek = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-11-12T00:00:00.000Z'),
    });

    await scheduler.settleLastWeek();

    const [settlement] = await prisma.settlement.findMany();
    expect(settlement.period_start).toEqual(dateOnly('2026-11-02'));
    expect(settlement.period_end).toEqual(dateOnly('2026-11-08'));
    expect(await settlementIdOf(before.id)).toBe(settlement.id);
    expect(await settlementIdOf(thisWeek.id)).toBeNull();
  });

  it('재실행해도 같은 주 정산·이벤트는 한 번만 생긴다', async () => {
    const store = await createStore(prisma);
    await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-11-10T00:00:00.000Z'),
    });

    await expect(scheduler.settleLastWeek()).resolves.toBe(1);
    await expect(scheduler.settleLastWeek()).resolves.toBe(0);

    expect(await prisma.settlement.count()).toBe(1);
    expect(await createdEvents()).toHaveLength(1);
    expect(alerts.notify).not.toHaveBeenCalled();
  });

  it('같은 주 정산이 이미 있으면 늦게 들어온 주문은 건드리지 않고 다음 주 정산에 넣는다', async () => {
    const store = await createStore(prisma);
    await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-11-10T00:00:00.000Z'),
    });
    await scheduler.settleLastWeek();
    // 첫 실행 뒤 커밋된 지난주 확정분(경계에 걸친 tx 등)
    const late = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-11-15T14:00:00.000Z'),
    });

    await expect(scheduler.settleLastWeek()).resolves.toBe(0);
    expect(await settlementIdOf(late.id)).toBeNull();
    // 이미 만든 주는 실패가 아니라 건너뜀이라 재실행마다 경보가 나가지 않는다
    expect(alerts.notify).not.toHaveBeenCalled();

    now = new Date(MONDAY_5AM.getTime() + WEEK_MS);
    await scheduler.settleLastWeek();
    const next = await prisma.settlement.findFirstOrThrow({
      where: { period_start: dateOnly('2026-11-16') },
    });
    expect(next.order_count).toBe(1);
    expect(await settlementIdOf(late.id)).toBe(next.id);
  });

  it('묵은 주문(몇 주 전 확정·미정산)도 이번 정산에 함께 묶는다', async () => {
    const store = await createStore(prisma);
    const stale = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-10-20T00:00:00.000Z'),
    });

    await scheduler.settleLastWeek();

    const [settlement] = await prisma.settlement.findMany();
    expect(settlement.period_start).toEqual(dateOnly('2026-11-09'));
    expect(await settlementIdOf(stale.id)).toBe(settlement.id);
  });

  it('확정 전·기준액 0·이미 정산됨·삭제된 주문·품목이 모두 삭제된 주문은 묶지 않는다', async () => {
    const store = await createStore(prisma);
    const at = new Date('2026-11-10T00:00:00.000Z');
    const target = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: at,
    });
    // 확정 전(결제만 확인)
    const unfinalized = await createOrder(prisma, { status: 'CONFIRMED' });
    await createOrderItem(prisma, {
      order_id: unfinalized.id,
      store_id: store.id,
    });
    await createPayment(prisma, {
      order_id: unfinalized.id,
      status: 'CONFIRMED',
      confirmed_at: at,
    });
    const zero = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: at,
      base_amount: 0,
    });
    const settled = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: at,
    });
    const old = await createSettlement(prisma, { store_id: store.id });
    await prisma.order.update({
      where: { id: settled.id },
      data: { settlement_id: old.id },
    });
    const deleted = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: at,
    });
    await prisma.order.update({
      where: { id: deleted.id },
      data: { deleted_at: at },
    });
    const itemDeleted = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: at,
    });
    await prisma.orderItem.updateMany({
      where: { order_id: itemDeleted.id },
      data: { deleted_at: at },
    });

    await scheduler.settleLastWeek();

    const created = await prisma.settlement.findFirstOrThrow({
      where: { period_start: dateOnly('2026-11-09') },
    });
    expect(created.order_count).toBe(1);
    expect(await settlementIdOf(target.id)).toBe(created.id);
    for (const order of [unfinalized, zero, deleted, itemDeleted]) {
      expect(await settlementIdOf(order.id)).toBeNull();
    }
    expect(await settlementIdOf(settled.id)).toBe(old.id);
  });

  it('이벤트를 적재한 뒤 tx가 실패하면 정산 행·주문 연결·이벤트가 모두 남지 않고 경보한 뒤, 다음 실행에서 다시 만든다', async () => {
    const store = await createStore(prisma);
    const order = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-11-10T00:00:00.000Z'),
    });
    // 적재는 실제로 하고 그 뒤에 실패시킨다 — 같은 tx가 아니면 이벤트 행이 남는다
    const publish = publisher.publish.bind(publisher);
    jest
      .spyOn(publisher, 'publish')
      .mockImplementationOnce(async (tx, event) => {
        await publish(tx, event);
        throw new Error('outbox down');
      });

    await expect(scheduler.settleLastWeek()).resolves.toBe(0);

    expect(await prisma.settlement.count()).toBe(0);
    expect(await settlementIdOf(order.id)).toBeNull();
    expect(await createdEvents()).toHaveLength(0);
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        key: 'order-cron:weekly-settlement',
        detail: expect.stringContaining('outbox down'),
      }),
    );

    await expect(scheduler.settleLastWeek()).resolves.toBe(1);
    expect(await createdEvents()).toHaveLength(1);
  });

  it('한 매장이 실패해도 다른 매장 정산은 만든다', async () => {
    const failing = await createStore(prisma);
    const healthy = await createStore(prisma);
    for (const store of [failing, healthy]) {
      await createFinalizedOrder(prisma, {
        store_id: store.id,
        finalized_at: new Date('2026-11-10T00:00:00.000Z'),
      });
    }
    // 매장 id 오름차순으로 돈다 — 첫 매장의 적재만 실패시킨다
    jest
      .spyOn(publisher, 'publish')
      .mockRejectedValueOnce(new Error('outbox down'));

    await expect(scheduler.settleLastWeek()).resolves.toBe(1);

    const settlements = await prisma.settlement.findMany();
    expect(settlements.map((s) => s.store_id)).toEqual([healthy.id]);
    expect(alerts.notify).toHaveBeenCalledTimes(1);
    expect(alerts.notify.mock.calls[0][0].detail).toContain(
      `매장 ${failing.id}`,
    );
  });

  it('후보 조회가 실패해도 던지지 않고 경보한다', async () => {
    jest
      .spyOn(repository, 'findUnsettledStoreIds')
      .mockRejectedValueOnce(new Error('db down'));

    await expect(scheduler.settleLastWeek()).resolves.toBe(0);
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'order-cron:weekly-settlement' }),
    );
  });

  it('겹친 실행은 건너뛴다', async () => {
    const store = await createStore(prisma);
    await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-11-10T00:00:00.000Z'),
    });

    const results = await Promise.all([
      scheduler.settleLastWeek(),
      scheduler.settleLastWeek(),
    ]);

    expect([...results].sort()).toEqual([0, 1]);
    expect(await prisma.settlement.count()).toBe(1);
  });

  describe('후보 배치·상한', () => {
    it.each([100, 101])(
      '후보 매장 %i곳을 100곳씩 키셋으로 나눠 모두 정산한다',
      async (count) => {
        const storeIds = await pendingStores(count);
        const find = jest.spyOn(repository, 'findUnsettledStoreIds');
        const warn = silenceWarn();

        await expect(scheduler.settleLastWeek()).resolves.toBe(count);

        expect(find.mock.calls.map(([args]) => args)).toEqual([
          { before: MONDAY_0AM, afterStoreId: undefined, limit: 100 },
          { before: MONDAY_0AM, afterStoreId: storeIds[99], limit: 100 },
        ]);
        const pages = await Promise.all(
          find.mock.results.map((r) => r.value as Promise<bigint[]>),
        );
        expect(pages.map((page) => page.length)).toEqual([100, count - 100]);
        expect(await settledStoreIds()).toEqual(storeIds);
        expect(warn).not.toHaveBeenCalled();
      },
    );

    it('운영 값은 배치 100곳·상한 1000곳이고, 상한에 닿으면 멈추고 남은 매장을 경고로 남긴다', async () => {
      expect(SETTLEMENT_BATCH_SIZE).toBe(100);
      expect(SETTLEMENT_MAX_PER_RUN).toBe(1000);
      // 후보 매장 1~1050 — 1000곳을 실제로 만들지 않고 루프만 본다(상한이 없으면 1050곳을 돈다)
      const find = jest
        .spyOn(repository, 'findUnsettledStoreIds')
        .mockImplementation(({ afterStoreId = 0n, limit }) =>
          Promise.resolve(
            Array.from(
              { length: Math.min(limit, 1050 - Number(afterStoreId)) },
              (_, i) => afterStoreId + BigInt(i + 1),
            ),
          ),
        );
      const create = jest
        .spyOn(repository, 'createWeeklySettlement')
        .mockResolvedValue(null);
      const warn = silenceWarn();

      await scheduler.settleLastWeek();

      expect(create).toHaveBeenCalledTimes(1000);
      expect(create.mock.calls[999][0].storeId).toBe(1000n);
      // 100곳씩 10쪽, 그 뒤 남은 매장이 있는지 1곳만 본다
      expect(find.mock.calls.map(([args]) => args.limit)).toEqual([
        ...Array<number>(10).fill(100),
        1,
      ]);
      expect(find.mock.calls[10][0].afterStoreId).toBe(1000n);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        '주간 정산 상한(1000곳)에 걸려 매장 1001부터는 다음 실행에서 정산한다',
      );
    });

    it('상한을 넘는 후보는 매장 id 순으로 상한만큼만 정산하고 경고를 남긴 뒤, 다음 실행에서 남은 매장을 정산한다', async () => {
      const storeIds = await pendingStores(7);
      const warn = silenceWarn();
      const limits = { batchSize: 2, maxPerRun: 5 };

      await expect(scheduler.settleLastWeek(limits)).resolves.toBe(5);

      expect(await settledStoreIds()).toEqual(storeIds.slice(0, 5));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        `주간 정산 상한(5곳)에 걸려 매장 ${storeIds[5]}부터는 다음 실행에서 정산한다`,
      );
      // 상한은 실패가 아니라 경보하지 않는다
      expect(alerts.notify).not.toHaveBeenCalled();

      // 다음 실행(부팅 등) — 정산된 매장은 후보에서 빠지고 남은 매장만 같은 주로 정산한다
      warn.mockClear();
      await expect(scheduler.settleLastWeek(limits)).resolves.toBe(2);

      expect(await settledStoreIds()).toEqual(storeIds);
      expect(await createdEvents()).toHaveLength(7);
      expect(
        await prisma.settlement.count({
          where: { period_start: dateOnly('2026-11-09') },
        }),
      ).toBe(7);
      expect(warn).not.toHaveBeenCalled();
    });

    it('반증: 후보가 상한과 같으면 모두 정산하고 경고하지 않는다', async () => {
      const storeIds = await pendingStores(4);
      const warn = silenceWarn();

      await expect(
        scheduler.settleLastWeek({ batchSize: 2, maxPerRun: 4 }),
      ).resolves.toBe(4);

      expect(await settledStoreIds()).toEqual(storeIds);
      expect(warn).not.toHaveBeenCalled();
    });

    it('키셋은 매장 id 오름차순이고, 실패한 매장은 같은 실행에서 다시 잡지 않는다', async () => {
      const stores = [];
      for (let i = 0; i < 5; i++) stores.push(await createStore(prisma));
      // 주문은 매장 역순으로 만들어 주문 id 순과 매장 id 순을 어긋나게 한다
      for (const store of [...stores].reverse()) {
        await createFinalizedOrder(prisma, {
          store_id: store.id,
          finalized_at: new Date('2026-11-10T00:00:00.000Z'),
        });
      }
      const storeIds = stores.map((store) => store.id);
      const find = jest.spyOn(repository, 'findUnsettledStoreIds');
      const create = jest.spyOn(repository, 'createWeeklySettlement');
      // 첫 매장만 실패 — 다음 쪽 후보에 그대로 남아 있다
      jest
        .spyOn(publisher, 'publish')
        .mockRejectedValueOnce(new Error('outbox down'));

      await expect(
        scheduler.settleLastWeek({ batchSize: 2, maxPerRun: 10 }),
      ).resolves.toBe(4);

      expect(create.mock.calls.map(([args]) => args.storeId)).toEqual(storeIds);
      expect(find.mock.calls.map(([args]) => args.afterStoreId)).toEqual([
        undefined,
        storeIds[1],
        storeIds[3],
      ]);
      expect(await settledStoreIds()).toEqual(storeIds.slice(1));
      expect(alerts.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('역할 게이트', () => {
    async function withPendingOrder() {
      const store = await createStore(prisma);
      await createFinalizedOrder(prisma, {
        store_id: store.id,
        finalized_at: new Date('2026-11-10T00:00:00.000Z'),
      });
    }

    it.each(['api', 'ws'])(
      '반증: %s 역할은 부팅·크론에서 정산을 만들지 않는다',
      async (role) => {
        process.env.APP_ROLE = role;
        await withPendingOrder();

        await scheduler.onApplicationBootstrap();
        await scheduler.weeklySettlement();

        expect(await prisma.settlement.count()).toBe(0);
      },
    );

    it('worker는 부팅 때 한 번, 크론마다 정산한다', async () => {
      await withPendingOrder();

      await scheduler.onApplicationBootstrap();
      expect(await prisma.settlement.count()).toBe(1);

      now = new Date(MONDAY_5AM.getTime() + WEEK_MS);
      await withPendingOrder();
      await scheduler.weeklySettlement();
      expect(await prisma.settlement.count()).toBe(2);
    });
  });
});
