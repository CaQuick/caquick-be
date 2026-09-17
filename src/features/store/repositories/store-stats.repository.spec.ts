import { StoreStatsRepository } from '@/features/store/repositories/store-stats.repository';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createOrder,
  createOrderItem,
  createProduct,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const SINCE = new Date('2026-09-01T00:00:00.000Z');
const IN_WINDOW = new Date('2026-09-10T00:00:00.000Z');

// repository에서만 도달 가능한 계약: 유효 주문 정의(상태·시각·삭제 제외)와 키별 그룹핑.
describe('StoreStatsRepository (real DB)', () => {
  let repo: StoreStatsRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [StoreStatsRepository],
    });
    repo = module.get(StoreStatsRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function placeOrder(args: {
    storeId: bigint;
    productId: bigint;
    quantity?: number;
    status?: OrderStatus;
    createdAt?: Date;
    deleted?: boolean;
  }): Promise<void> {
    const order = await createOrder(prisma, {
      status: args.status ?? 'PICKED_UP',
      created_at: args.createdAt ?? IN_WINDOW,
      ...(args.deleted ? { deleted_at: new Date() } : {}),
    });
    await createOrderItem(prisma, {
      order_id: order.id,
      store_id: args.storeId,
      product_id: args.productId,
      quantity: args.quantity ?? 1,
    });
  }

  it('ids가 비면 쿼리 없이 빈 Map', async () => {
    await expect(
      repo.aggregateRecentOrderCounts('store_id', [], SINCE),
    ).resolves.toEqual(new Map());
    await expect(
      repo.aggregateSoldQuantities('product_id', [], SINCE),
    ).resolves.toEqual(new Map());
  });

  it('키별로 그룹핑한다 — store_id 주문 수 / product_id 판매 수량', async () => {
    const store = await createStore(prisma);
    const p1 = await createProduct(prisma, { store_id: store.id });
    const p2 = await createProduct(prisma, { store_id: store.id });
    await placeOrder({ storeId: store.id, productId: p1.id, quantity: 2 });
    await placeOrder({ storeId: store.id, productId: p2.id, quantity: 3 });

    const byStore = await repo.aggregateRecentOrderCounts(
      'store_id',
      [store.id],
      SINCE,
    );
    expect(byStore.get(store.id)).toBe(2);

    const byProduct = await repo.aggregateSoldQuantities(
      'product_id',
      [p1.id, p2.id],
      SINCE,
    );
    expect(byProduct.get(p1.id)).toBe(2);
    expect(byProduct.get(p2.id)).toBe(3);
  });

  // 유효 주문 정의 반증: 삭제 주문·비유효 상태·since 이전은 집계에서 빠진다
  it.each([
    ['soft-delete 주문', { deleted: true }],
    ['비유효 상태(CANCELED)', { status: 'CANCELED' as OrderStatus }],
    ['since 이전 주문', { createdAt: new Date('2026-08-31T23:59:59.999Z') }],
  ])('%s은 집계하지 않는다', async (_label, override) => {
    const store = await createStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });
    await placeOrder({ storeId: store.id, productId: product.id, ...override });
    await placeOrder({ storeId: store.id, productId: product.id, quantity: 4 });

    const counts = await repo.aggregateRecentOrderCounts(
      'product_id',
      [product.id],
      SINCE,
    );
    const sold = await repo.aggregateSoldQuantities(
      'store_id',
      [store.id],
      SINCE,
    );
    expect(counts.get(product.id)).toBe(1);
    expect(sold.get(store.id)).toBe(4);
  });

  it('since 경계(같은 시각)는 포함한다', async () => {
    const store = await createStore(prisma);
    const product = await createProduct(prisma, { store_id: store.id });
    await placeOrder({
      storeId: store.id,
      productId: product.id,
      createdAt: SINCE,
    });

    const counts = await repo.aggregateRecentOrderCounts(
      'store_id',
      [store.id],
      SINCE,
    );
    expect(counts.get(store.id)).toBe(1);
  });
});
