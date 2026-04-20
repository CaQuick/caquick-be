import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserSearchMutationResolver } from '@/features/user/resolvers/user-search-mutation.resolver';
import { UserSearchQueryResolver } from '@/features/user/resolvers/user-search-query.resolver';
import { UserSearchService } from '@/features/user/services/user-search.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createSearchHistory,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('User Search Resolvers (real DB)', () => {
  let queryResolver: UserSearchQueryResolver;
  let mutationResolver: UserSearchMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        UserSearchQueryResolver,
        UserSearchMutationResolver,
        UserSearchService,
        UserRepository,
      ],
    });
    queryResolver = module.get(UserSearchQueryResolver);
    mutationResolver = module.get(UserSearchMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.mySearchHistories: DB 조회 결과를 DTO로 반환', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    await createSearchHistory(prisma, {
      account_id: account.id,
      keyword: 'cake',
    });

    const result = await queryResolver.mySearchHistories(
      { accountId: account.id.toString() },
      { offset: 0, limit: 10 },
    );

    expect(result.totalCount).toBe(1);
    expect(result.items[0].keyword).toBe('cake');
  });

  it('Mutation.clearSearchHistories: 본인 검색 기록 전체 soft-delete', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    await createSearchHistory(prisma, { account_id: account.id });

    const ok = await mutationResolver.clearSearchHistories({
      accountId: account.id.toString(),
    });
    expect(ok).toBe(true);

    const remaining = await prisma.searchHistory.count({
      where: { account_id: account.id, deleted_at: null },
    });
    expect(remaining).toBe(0);
  });

  it('Mutation.deleteSearchHistory: 미존재 id는 NotFoundException 전파', async () => {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });

    await expect(
      mutationResolver.deleteSearchHistory(
        { accountId: account.id.toString() },
        '999999',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
