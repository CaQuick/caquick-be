import argon2 from 'argon2';

import { seedAdmins } from '../../prisma/seed/admins';
import { seedCategories } from '../../prisma/seed/categories';
import {
  SEED_ADMIN_USERNAME,
  SEED_PASSWORD,
} from '../../prisma/seed/credential-policy';
import {
  SEED_STORE_NAME_PREFIX,
  resetSeedScope,
} from '../../prisma/seed/idempotent';
import { seedOrders } from '../../prisma/seed/orders';
import {
  SEED_SETTLEMENT_ACCOUNT,
  seedPayments,
} from '../../prisma/seed/payments';
import { seedRegions } from '../../prisma/seed/regions';
import { seedReviews } from '../../prisma/seed/reviews';
import { seedStores } from '../../prisma/seed/stores';
import { seedUsers, type SeededUser } from '../../prisma/seed/users';

import { readAccountCryptoConfig } from '@/config/account-crypto.config';
import type { PrismaClient } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createNotification,
  createOrder,
  createOrderItem,
  createReview,
  createReviewReport,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 로컬에서 시드 데이터에 붙여 둔 행이 있어도 재시드(정리 → 재삽입)가 FK에 막히면 안 된다
describe('resetSeedScope (real DB)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = await createTestingModuleWithRealDb({ providers: [] }));
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /** 시드 main과 같은 순서로 리뷰까지 채운다 */
  async function seedThroughReviews(): Promise<SeededUser[]> {
    const users = await seedUsers(prisma);
    await seedRegions(prisma);
    const categories = await seedCategories(prisma);
    const stores = await seedStores(prisma, { categories });
    const orders = await seedOrders(prisma, { users, stores });
    await seedReviews(prisma, { users, stores, orders });
    return users;
  }

  function writeComment(reviewId: bigint, accountId: bigint) {
    return prisma.reviewComment.create({
      data: { review_id: reviewId, account_id: accountId, content: '댓글' },
    });
  }

  it('기본 테스트 계정(관리자·판매자)을 만들고 재시드해도 아이디가 겹치지 않는다', async () => {
    const usernames = [SEED_ADMIN_USERNAME, 'seed-seller-a', 'seed-seller-b'];
    await seedThroughReviews();
    await seedAdmins(prisma);

    await resetSeedScope(prisma);
    await seedThroughReviews();
    await seedAdmins(prisma);

    const credentials = await prisma.accountCredential.findMany({
      where: { username: { in: usernames } },
    });
    expect(credentials.map((c) => c.username).sort()).toEqual(
      [...usernames].sort(),
    );
    for (const c of credentials) {
      expect(await argon2.verify(c.password_hash, SEED_PASSWORD)).toBe(true);
      expect(c.must_change_password).toBe(false);
    }
  });

  /** 시드 밖 계정의 주문 1건(품목 1개)을 만든다. productId를 안 주면 시드 밖 매장 상품으로 */
  async function outsiderOrder(productId?: bigint) {
    const outsider = await createAccount(prisma, { account_type: 'USER' });
    const order = await createOrder(prisma, { account_id: outsider.id });
    const item = await createOrderItem(prisma, {
      order_id: order.id,
      ...(productId ? { product_id: productId } : {}),
    });
    return { outsider, order, item };
  }

  it('시드 사용자 없이 시드 매장과 시드 밖 주문만 남은 상태(이전 재시드 실패)도 정리한다', async () => {
    // 이전 재시드가 상품 삭제에서 실패하면 시드 사용자는 이미 지워져 이 상태가 남는다
    await seedRegions(prisma);
    const categories = await seedCategories(prisma);
    const { products } = await seedStores(prisma, { categories });
    const { order } = await outsiderOrder(products[0].id);

    await resetSeedScope(prisma);

    expect(
      await prisma.order.findUnique({ where: { id: order.id } }),
    ).toBeNull();
    expect(
      await prisma.store.count({
        where: { store_name: { startsWith: SEED_STORE_NAME_PREFIX } },
      }),
    ).toBe(0);
  });

  it('시드 밖 계정이 시드 상품을 주문하고 리뷰를 남겨도 정리하고 다시 시드한다', async () => {
    await seedThroughReviews();
    const seedProduct = await prisma.product.findFirstOrThrow({
      where: { store: { store_name: { startsWith: SEED_STORE_NAME_PREFIX } } },
    });
    const { outsider, order, item } = await outsiderOrder(seedProduct.id);
    const review = await createReview(prisma, { order_item_id: item.id });
    const notification = await createNotification(prisma, {
      account_id: outsider.id,
      order_id: order.id,
      order_item_id: item.id,
      review_id: review.id,
    });

    await resetSeedScope(prisma);
    await seedThroughReviews();

    expect(
      await prisma.order.findUnique({ where: { id: order.id } }),
    ).toBeNull();
    expect(
      await prisma.review.findUnique({ where: { id: review.id } }),
    ).toBeNull();
    expect(
      await prisma.notification.findUnique({ where: { id: notification.id } }),
    ).toBeNull();
    expect(
      await prisma.account.findUnique({ where: { id: outsider.id } }),
    ).not.toBeNull();
  });

  it('시드 주문과 시드 상품을 산 외부 주문에 커스텀 디자인·이미지가 붙어도 정리하고 다시 시드한다', async () => {
    await seedThroughReviews();
    const seedProduct = await prisma.product.findFirstOrThrow({
      where: { store: { store_name: { startsWith: SEED_STORE_NAME_PREFIX } } },
    });
    const { item } = await outsiderOrder(seedProduct.id);
    await prisma.orderItemCustomDesign.create({
      data: { order_item_id: item.id, schema_version: 1, design_json: {} },
    });
    await prisma.orderItemCustomImage.create({
      data: {
        order_item_id: item.id,
        kind: 'THREE_D_TOP',
        image_url: 'https://img/top.png',
      },
    });
    const counts = () =>
      Promise.all([
        prisma.orderItemCustomDesign.count(),
        prisma.orderItemCustomImage.count(),
      ]);
    // 시드도 슬롯형 합성 이미지를 2장 넣는다
    expect(await counts()).toEqual([1, 3]);

    await resetSeedScope(prisma);
    expect(await counts()).toEqual([0, 0]);

    await seedThroughReviews();
    expect(await counts()).toEqual([0, 2]);
  });

  it('시드 밖 계정이 시드 밖 매장에 넣은 주문은 남긴다', async () => {
    await seedThroughReviews();
    const { order, item } = await outsiderOrder();
    const notification = await createNotification(prisma, {
      account_id: order.account_id,
      order_id: order.id,
      order_item_id: item.id,
    });

    await resetSeedScope(prisma);

    expect(
      await prisma.order.findUnique({ where: { id: order.id } }),
    ).not.toBeNull();
    expect(
      await prisma.notification.findUnique({ where: { id: notification.id } }),
    ).not.toBeNull();
  });

  it('시드 리뷰에 다른 계정이 단 댓글이 있어도 정리하고 다시 시드한다', async () => {
    const users = await seedThroughReviews();
    const seedReview = await prisma.review.findFirstOrThrow({
      where: { account_id: { in: users.map((u) => u.id) } },
    });
    const outsider = await createAccount(prisma, { account_type: 'USER' });
    const comment = await writeComment(seedReview.id, outsider.id);

    await resetSeedScope(prisma);
    await seedThroughReviews();

    expect(
      await prisma.reviewComment.findUnique({ where: { id: comment.id } }),
    ).toBeNull();
    expect(
      await prisma.account.findUnique({ where: { id: outsider.id } }),
    ).not.toBeNull();
  });

  it('시드 리뷰에 달린 외부 댓글의 외부 신고도 지워 대상 없는 신고가 남지 않는다', async () => {
    const users = await seedThroughReviews();
    const seedReview = await prisma.review.findFirstOrThrow({
      where: { account_id: { in: users.map((u) => u.id) } },
    });
    const outsider = await createAccount(prisma, { account_type: 'USER' });
    const comment = await writeComment(seedReview.id, outsider.id);
    const report = await createReviewReport(prisma, {
      review_comment_id: comment.id,
    });

    await resetSeedScope(prisma);

    expect(
      await prisma.reviewReport.findUnique({ where: { id: report.id } }),
    ).toBeNull();
  });

  it('결제·환불·입금 기록·픽업 변경·정산·정산 계좌가 붙어도 정리하고 다시 시드하며 결제 설정은 남긴다', async () => {
    const seedAll = async () => {
      const users = await seedUsers(prisma);
      await seedRegions(prisma);
      const categories = await seedCategories(prisma);
      const stores = await seedStores(prisma, { categories });
      const orders = await seedOrders(prisma, { users, stores });
      const admin = await seedAdmins(prisma);
      await seedPayments(prisma, { orders, stores, admin });
      return { stores, orders };
    };
    const { stores, orders } = await seedAll();
    const [storeA] = stores.stores;
    const settlement = await prisma.settlement.create({
      data: {
        store_id: storeA.id,
        store_name_snapshot: storeA.store_name,
        period_start: new Date('2026-11-02'),
        period_end: new Date('2026-11-08'),
        order_count: 1,
        settlement_base_amount: 25000,
        commission_amount: 0,
        payout_amount: 25000,
      },
    });
    await prisma.order.update({
      where: { id: orders.o8NoShow },
      data: { settlement_id: settlement.id },
    });
    await prisma.orderPickupChange.create({
      data: {
        order_id: orders.o11PaidSubmitted,
        from_pickup_at: new Date('2026-11-20T03:00:00Z'),
        to_pickup_at: new Date('2026-11-21T03:00:00Z'),
        changed_by_account_id: storeA.seller_account_id,
        changed_at: new Date(),
      },
    });
    const counts = () =>
      Promise.all([
        prisma.payment.count(),
        prisma.refund.count(),
        prisma.depositRecord.count(),
        prisma.storeSettlementAccount.count(),
      ]);
    expect(await counts()).toEqual([5, 2, 1, 1]);

    await resetSeedScope(prisma);
    for (const count of await Promise.all([
      prisma.payment.count(),
      prisma.refund.count(),
      prisma.depositRecord.count(),
      prisma.orderPickupChange.count(),
      prisma.settlement.count(),
      prisma.storeSettlementAccount.count(),
    ])) {
      expect(count).toBe(0);
    }
    expect(await prisma.paymentSetting.count()).toBe(1);

    await seedAll();
    expect(await counts()).toEqual([5, 2, 1, 1]);
    expect(await prisma.paymentSetting.count()).toBe(1);
  });

  it('seed-seller-a 매장 정산 계좌는 앱과 같은 키 설정으로 암호화돼 풀린다', async () => {
    const users = await seedUsers(prisma);
    await seedRegions(prisma);
    const categories = await seedCategories(prisma);
    const stores = await seedStores(prisma, { categories });
    const orders = await seedOrders(prisma, { users, stores });
    const admin = await seedAdmins(prisma);
    await seedPayments(prisma, { orders, stores, admin });

    const [storeA] = stores.stores;
    const account = await prisma.storeSettlementAccount.findUniqueOrThrow({
      where: { store_id: storeA.id },
    });
    expect(account).toMatchObject({
      bank_code: SEED_SETTLEMENT_ACCOUNT.bank_code,
      account_number_last4: SEED_SETTLEMENT_ACCOUNT.account_number.slice(-4),
      updated_by_account_id: storeA.seller_account_id,
      updated_by_role: 'SELLER',
    });
    expect(account.account_number_enc).not.toContain(
      SEED_SETTLEMENT_ACCOUNT.account_number,
    );
    expect(
      new AccountCipher(readAccountCryptoConfig()).decrypt(
        account.account_number_enc,
        'settlement-account',
      ),
    ).toBe(SEED_SETTLEMENT_ACCOUNT.account_number);
  });

  it('시드 사용자가 시드 밖 리뷰에 단 댓글은 지우고 그 리뷰는 남긴다', async () => {
    const [seedUser] = await seedThroughReviews();
    const outsideReview = await createReview(prisma);
    const comment = await writeComment(outsideReview.id, seedUser.id);

    await resetSeedScope(prisma);

    expect(
      await prisma.reviewComment.findUnique({ where: { id: comment.id } }),
    ).toBeNull();
    expect(
      await prisma.review.findUnique({ where: { id: outsideReview.id } }),
    ).not.toBeNull();
  });

  it('시드 주문 밖에 있는 시드 사용자 리뷰의 댓글도 지운다', async () => {
    const [seedUser] = await seedThroughReviews();
    const outsideItem = await createOrderItem(prisma);
    const review = await createReview(prisma, {
      order_item_id: outsideItem.id,
      account_id: seedUser.id,
    });
    const outsider = await createAccount(prisma, { account_type: 'USER' });
    const comment = await writeComment(review.id, outsider.id);

    await resetSeedScope(prisma);

    expect(
      await prisma.review.findUnique({ where: { id: review.id } }),
    ).toBeNull();
    expect(
      await prisma.reviewComment.findUnique({ where: { id: comment.id } }),
    ).toBeNull();
  });
});
