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
import { seedRegions } from '../../prisma/seed/regions';
import { seedReviews } from '../../prisma/seed/reviews';
import { seedStores } from '../../prisma/seed/stores';
import { seedUsers, type SeededUser } from '../../prisma/seed/users';

import type { PrismaClient } from '@/generated/prisma/client';
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
