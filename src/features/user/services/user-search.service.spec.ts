import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserSearchService } from '@/features/user/services/user-search.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createSearchHistory,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('UserSearchService (real DB)', () => {
  let service: UserSearchService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [UserSearchService, UserRepository],
    });
    service = module.get(UserSearchService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupUser() {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    return account;
  }

  // ─── mySearchHistories ───
  describe('mySearchHistories', () => {
    it('last_used_at desc 정렬로 페이지네이션된 결과를 반환한다', async () => {
      const account = await setupUser();
      const a = await createSearchHistory(prisma, {
        account_id: account.id,
        keyword: '오래된',
        last_used_at: new Date('2026-04-01'),
      });
      const b = await createSearchHistory(prisma, {
        account_id: account.id,
        keyword: '최근',
        last_used_at: new Date('2026-04-20'),
      });

      const result = await service.mySearchHistories(account.id, {
        offset: 0,
        limit: 10,
      });

      expect(result.totalCount).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.items[0].id).toBe(b.id.toString());
      expect(result.items[0].keyword).toBe('최근');
      expect(result.items[1].id).toBe(a.id.toString());
    });

    it('hasMore 플래그를 offset/limit에 맞게 계산한다', async () => {
      const account = await setupUser();
      for (let i = 0; i < 3; i++) {
        await createSearchHistory(prisma, {
          account_id: account.id,
          keyword: `k${i}`,
          last_used_at: new Date(2026, 3, 20 - i),
        });
      }

      const result = await service.mySearchHistories(account.id, {
        offset: 0,
        limit: 2,
      });

      expect(result.totalCount).toBe(3);
      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(2);
    });

    it('다른 계정의 검색 기록은 포함되지 않는다', async () => {
      const me = await setupUser();
      const other = await setupUser();
      await createSearchHistory(prisma, { account_id: me.id, keyword: 'mine' });
      await createSearchHistory(prisma, {
        account_id: other.id,
        keyword: 'other',
      });

      const result = await service.mySearchHistories(me.id);

      expect(result.totalCount).toBe(1);
      expect(result.items[0].keyword).toBe('mine');
    });
  });

  // ─── deleteSearchHistory ───
  describe('deleteSearchHistory', () => {
    it('본인 기록이면 soft-delete하고 true 반환', async () => {
      const account = await setupUser();
      const history = await createSearchHistory(prisma, {
        account_id: account.id,
      });

      const result = await service.deleteSearchHistory(account.id, history.id);

      expect(result).toBe(true);
      const saved = await prisma.searchHistory.findUniqueOrThrow({
        where: { id: history.id },
      });
      expect(saved.deleted_at).not.toBeNull();
    });

    it('이미 삭제된 기록이면 NotFoundException', async () => {
      const account = await setupUser();
      const history = await createSearchHistory(prisma, {
        account_id: account.id,
        deleted_at: new Date(),
      });

      await expect(
        service.deleteSearchHistory(account.id, history.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('존재하지 않는 id면 NotFoundException', async () => {
      const account = await setupUser();
      await expect(
        service.deleteSearchHistory(account.id, BigInt(999999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 계정의 기록은 접근 불가 (NotFoundException)', async () => {
      const me = await setupUser();
      const other = await setupUser();
      const othersHistory = await createSearchHistory(prisma, {
        account_id: other.id,
      });

      await expect(
        service.deleteSearchHistory(me.id, othersHistory.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── clearSearchHistories ───
  describe('clearSearchHistories', () => {
    it('해당 계정의 모든 active 기록을 soft-delete한다', async () => {
      const account = await setupUser();
      for (let i = 0; i < 3; i++) {
        await createSearchHistory(prisma, {
          account_id: account.id,
          keyword: `k${i}`,
        });
      }

      const result = await service.clearSearchHistories(account.id);

      expect(result).toBe(true);
      const active = await prisma.searchHistory.count({
        where: { account_id: account.id, deleted_at: null },
      });
      expect(active).toBe(0);
    });

    it('기록이 없어도 true를 반환한다', async () => {
      const account = await setupUser();
      const result = await service.clearSearchHistories(account.id);
      expect(result).toBe(true);
    });

    it('다른 계정의 기록은 영향을 받지 않는다', async () => {
      const me = await setupUser();
      const other = await setupUser();
      await createSearchHistory(prisma, { account_id: me.id });
      await createSearchHistory(prisma, { account_id: other.id });

      await service.clearSearchHistories(me.id);

      const otherActive = await prisma.searchHistory.count({
        where: { account_id: other.id, deleted_at: null },
      });
      expect(otherActive).toBe(1);
    });
  });
});
