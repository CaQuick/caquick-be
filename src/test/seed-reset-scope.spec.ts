import { seedCategories } from '../../prisma/seed/categories';
import { resetSeedScope } from '../../prisma/seed/idempotent';
import { seedOrders } from '../../prisma/seed/orders';
import { seedRegions } from '../../prisma/seed/regions';
import { seedReviews } from '../../prisma/seed/reviews';
import { seedStores } from '../../prisma/seed/stores';
import { seedUsers, type SeededUser } from '../../prisma/seed/users';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createOrderItem, createReview } from '@/test/factories';
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
