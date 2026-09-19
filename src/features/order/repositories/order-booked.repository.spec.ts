import { OrderBookedRepository } from '@/features/order/repositories/order-booked.repository';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createOrder, createOrderItem, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// catalog 픽업 판정이 포트로 읽는 예약 수량. SUM 기준·제외 규칙(CANCELED·soft-delete)은 order가 단일 소스다(D7-a).
describe('OrderBookedRepository (real DB)', () => {
  let repo: OrderBookedRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [OrderBookedRepository],
    });
    repo = module.get(OrderBookedRepository);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  /** 2026-06-01 14:00 KST */
  const PICKUP = new Date('2026-06-01T05:00:00.000Z');
  const RANGE_START = new Date('2026-05-31T15:00:00.000Z');
  const RANGE_END = new Date('2026-06-01T15:00:00.000Z');

  async function book(args: {
    storeId: bigint;
    quantity?: number;
    pickupAt?: Date;
    status?: OrderStatus;
    orderDeleted?: boolean;
    itemDeleted?: boolean;
  }) {
    const order = await createOrder(prisma, {
      status: args.status ?? 'CONFIRMED',
      pickup_at: args.pickupAt ?? PICKUP,
      ...(args.orderDeleted ? { deleted_at: new Date() } : {}),
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      store_id: args.storeId,
      quantity: args.quantity ?? 1,
      ...(args.itemDeleted ? { deleted_at: new Date() } : {}),
    });
  }

  it('sumByStore는 매장별 수량 합을 내고 CANCELED·삭제 주문·삭제 품목·범위 밖은 제외한다', async () => {
    const [a, b, quiet] = await Promise.all([
      createStore(prisma),
      createStore(prisma),
      createStore(prisma),
    ]);
    await book({ storeId: a.id, quantity: 2 });
    await book({ storeId: a.id, quantity: 3 });
    await book({ storeId: b.id, quantity: 1 });
    await book({ storeId: a.id, quantity: 9, status: 'CANCELED' });
    await book({ storeId: a.id, quantity: 9, orderDeleted: true });
    await book({ storeId: a.id, quantity: 9, itemDeleted: true });
    await book({
      storeId: a.id,
      quantity: 9,
      pickupAt: new Date('2026-06-02T05:00:00.000Z'),
    });

    const result = await repo.sumByStore(
      [a.id, b.id, quiet.id],
      RANGE_START,
      RANGE_END,
    );

    expect(result.get(a.id)).toBe(5);
    expect(result.get(b.id)).toBe(1);
    // 예약이 없는 매장은 키가 없다(호출부가 0으로 해석)
    expect(result.has(quiet.id)).toBe(false);
  });

  it('빈 매장 목록은 쿼리 없이 빈 Map', async () => {
    expect(await repo.sumByStore([], RANGE_START, RANGE_END)).toEqual(
      new Map(),
    );
  });

  it('sumByKstDate는 KST 달력일로 묶는다(UTC 자정 전후가 같은 날)', async () => {
    const store = await createStore(prisma);
    // 2026-06-01 09:00 KST(UTC 00:00) — UTC로는 6/1, KST로도 6/1
    await book({
      storeId: store.id,
      quantity: 1,
      pickupAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    // 2026-06-01 00:30 KST(UTC 5/31 15:30) — UTC로는 5/31이지만 KST로는 6/1
    await book({
      storeId: store.id,
      quantity: 2,
      pickupAt: new Date('2026-05-31T15:30:00.000Z'),
    });
    // 2026-06-02 09:00 KST — 다른 날
    await book({
      storeId: store.id,
      quantity: 4,
      pickupAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    await book({ storeId: store.id, quantity: 9, status: 'CANCELED' });

    const result = await repo.sumByKstDate(
      store.id,
      RANGE_START,
      new Date('2026-06-02T15:00:00.000Z'),
    );

    expect(result.get('2026-06-01')).toBe(3);
    expect(result.get('2026-06-02')).toBe(4);
  });
});
