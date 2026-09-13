// 분기/검증 세부는 user-report.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.
import type { PrismaClient } from '@prisma/client';

import { ReviewReportRepository } from '@/features/user/repositories/review-report.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserReportMutationResolver } from '@/features/user/resolvers/user-report-mutation.resolver';
import { UserReportService } from '@/features/user/services/user-report.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createReview,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('User Report Resolver (real DB)', () => {
  let resolver: UserReportMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserReportMutationResolver,
        UserReportService,
        UserRepository,
        ReviewReportRepository,
      ],
    });
    resolver = module.get(UserReportMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Mutation.reportReview → 접수, 같은 입력 재요청은 alreadyReported', async () => {
    const reporter = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: reporter.id });
    const review = await createReview(prisma);
    const user = {
      accountId: reporter.id.toString(),
      accountType: 'USER' as const,
    };

    const first = await resolver.reportReview(user, {
      reviewId: review.id.toString(),
      reason: 'INAPPROPRIATE',
    });
    const second = await resolver.reportReview(user, {
      reviewId: review.id.toString(),
      reason: 'INAPPROPRIATE',
    });

    expect(first.alreadyReported).toBe(false);
    expect(second.reportId).toBe(first.reportId);
    expect(second.alreadyReported).toBe(true);
  });
});
