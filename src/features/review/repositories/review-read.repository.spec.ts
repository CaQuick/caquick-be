import { ReviewReadRepository } from '@/features/review/repositories/review-read.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection } from '@/test/db/truncate';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// repository에서만 도달 가능한 계약: 빈 id 배열은 쿼리 없이 빈 컬렉션.
describe('ReviewReadRepository (real DB)', () => {
  let repo: ReviewReadRepository;

  beforeAll(async () => {
    const { module } = await createTestingModuleWithRealDb({
      providers: [ReviewReadRepository],
    });
    repo = module.get(ReviewReadRepository);
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  it('reviewIds가 비면 쿼리 없이 빈 컬렉션을 반환한다', async () => {
    await expect(repo.aggregateLikeCounts([])).resolves.toEqual(new Map());
    await expect(repo.aggregateCommentCounts([])).resolves.toEqual(new Map());
    await expect(
      repo.findLikedReviewIds({ reviewIds: [], accountId: BigInt(1) }),
    ).resolves.toEqual(new Set());
    await expect(repo.findReviewRowsByIds([])).resolves.toEqual([]);
    await expect(repo.findShowcaseReviewRowsByIds([])).resolves.toEqual([]);
  });
});
