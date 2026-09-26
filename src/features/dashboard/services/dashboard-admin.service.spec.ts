import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { AdminDashboardService } from '@/features/dashboard/services/dashboard-admin.service';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { ProductAdminRepository } from '@/features/product/repositories/product-admin.repository';
import { ReviewAdminRepository } from '@/features/review/repositories/review-admin.repository';
import { SearchRepository } from '@/features/search';
import { StoreAdminRepository } from '@/features/store/repositories/store-admin.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createProduct,
  createReview,
  createReviewReport,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

describe('AdminDashboardService (real DB)', () => {
  let service: AdminDashboardService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminDashboardService,
        OrderRepository,
        StoreAdminRepository,
        ProductAdminRepository,
        ReviewAdminRepository,
        AccountAdminRepository,
        SearchRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        // 발행 repository가 OutboxPublisher를 주입받는다(08b)
        ...outboxPublisherProviders(),
      ],
    });
    service = module.get(AdminDashboardService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2026-09-30T23:59:59Z');
  const inRange = new Date('2026-09-10T00:00:00Z');
  const outOfRange = new Date('2026-08-31T23:59:59Z');

  describe('adminDashboardSummary', () => {
    it('기간 안 가입·주문만 세고 취소 주문은 금액 합에서 뺀다', async () => {
      const actor = await admin();
      const user = await createAccount(prisma, {
        account_type: 'USER',
        created_at: inRange,
      });
      await createAccount(prisma, {
        account_type: 'USER',
        created_at: outOfRange,
      });
      await createAccount(prisma, {
        account_type: 'USER',
        created_at: inRange,
        deleted_at: inRange,
      });
      const seller = await createAccount(prisma, {
        account_type: 'SELLER',
        created_at: inRange,
      });
      const store = await createStore(prisma, { seller_account_id: seller.id });
      // 매장은 판매자당 1개(unique) — 비활성 매장은 기간 밖 판매자에게 붙인다
      await createStore(prisma, {
        seller_account_id: (
          await createAccount(prisma, {
            account_type: 'SELLER',
            created_at: outOfRange,
          })
        ).id,
        is_active: false,
      });
      const product = await createProduct(prisma, { store_id: store.id });
      await createProduct(prisma, { store_id: store.id, is_active: false });
      await createProduct(prisma, { store_id: store.id, deleted_at: inRange });
      const submitted = await createOrder(prisma, {
        account_id: user.id,
        status: 'SUBMITTED',
        total_price: 1_000,
        created_at: inRange,
      });
      await createOrder(prisma, {
        account_id: user.id,
        status: 'PICKED_UP',
        total_price: 2_000,
        created_at: inRange,
      });
      await createOrder(prisma, {
        account_id: user.id,
        status: 'CANCELED',
        total_price: 5_000,
        created_at: inRange,
      });
      await createOrder(prisma, {
        account_id: user.id,
        status: 'MADE',
        total_price: 9_000,
        created_at: outOfRange,
      });
      // 신고 대상 리뷰는 위 매장·주문에 붙인다 — 팩토리 기본값이 계정·매장·주문을 새로 만들면 집계가 흔들린다
      const item = await createOrderItem(prisma, {
        order_id: submitted.id,
        product_id: product.id,
      });
      const review = await createReview(prisma, { order_item_id: item.id });
      await createReviewReport(prisma, {
        reporter_account_id: user.id,
        review_id: review.id,
      });
      await createReviewReport(prisma, {
        reporter_account_id: user.id,
        review_id: review.id,
        status: 'REJECTED',
      });

      const result = await service.adminDashboardSummary(actor, { from, to });

      expect(result).toEqual({
        from,
        to,
        newUserCount: 1,
        newSellerCount: 1,
        orderCounts: {
          submitted: 1,
          confirmed: 0,
          made: 0,
          pickedUp: 1,
          canceled: 1,
        },
        orderAmountSum: 3_000,
        activeStoreCount: 1,
        activeProductCount: 1,
        pendingReportCount: 1,
      });
    });

    it('from > to 거절', async () => {
      const actor = await admin();
      await expect(
        service.adminDashboardSummary(actor, { from: to, to: from }),
      ).rejects.toThrowDomain(400);
    });

    it('366일 초과 거절, 정확히 366일은 허용', async () => {
      const actor = await admin();
      const start = new Date('2025-01-01T00:00:00Z');
      const okEnd = new Date(start.getTime() + 366 * 24 * 60 * 60 * 1000);
      await expect(
        service.adminDashboardSummary(actor, { from: start, to: okEnd }),
      ).resolves.toMatchObject({
        newUserCount: 0,
      });
      await expect(
        service.adminDashboardSummary(actor, {
          from: start,
          to: new Date(okEnd.getTime() + 1),
        }),
      ).rejects.toThrowDomain(400);
    });
  });

  describe('adminSearchKeywordSnapshot', () => {
    async function seedSnapshot(
      rankedAt: Date,
      keywords: string[],
    ): Promise<void> {
      await prisma.searchKeywordRankSnapshot.createMany({
        data: keywords.map((keyword, i) => ({
          ranked_at: rankedAt,
          rank: i + 1,
          keyword,
          search_count: 100 - i,
        })),
      });
    }

    it('스냅샷이 없으면 rankedAt null·빈 목록', async () => {
      const actor = await admin();
      expect(await service.adminSearchKeywordSnapshot(actor)).toEqual({
        rankedAt: null,
        items: [],
      });
    });

    it('rankedAt 미지정이면 최신 스냅샷을 limit만큼 순위순으로', async () => {
      const actor = await admin();
      const older = new Date('2026-09-13T01:00:00Z');
      const latest = new Date('2026-09-13T02:00:00Z');
      await seedSnapshot(older, ['옛날']);
      await seedSnapshot(latest, ['케이크', '마카롱', '쿠키']);

      const result = await service.adminSearchKeywordSnapshot(actor, {
        limit: 2,
      });

      expect(result.rankedAt).toEqual(latest);
      expect(result.items).toEqual([
        { rank: 1, keyword: '케이크', searchCount: 100 },
        { rank: 2, keyword: '마카롱', searchCount: 99 },
      ]);
    });

    it('rankedAt 지정 시 그 시각 스냅샷, 없는 시각이면 rankedAt null', async () => {
      const actor = await admin();
      const at = new Date('2026-09-13T01:00:00Z');
      await seedSnapshot(at, ['옛날']);

      expect(
        await service.adminSearchKeywordSnapshot(actor, { rankedAt: at }),
      ).toEqual({
        rankedAt: at,
        items: [{ rank: 1, keyword: '옛날', searchCount: 100 }],
      });
      expect(
        await service.adminSearchKeywordSnapshot(actor, {
          rankedAt: new Date('2026-09-13T03:00:00Z'),
        }),
      ).toEqual({ rankedAt: null, items: [] });
    });
  });
});
