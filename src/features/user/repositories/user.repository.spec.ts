import type { PrismaClient } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createUserProfile } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * 본 spec은 UserRepository 중 "서비스/리졸버 spec으로는 직접 도달이 어려운"
 * API contract만 좁게 검증한다. 일반적인 비즈니스 분기는 service spec에서
 * 다룬다는 컨벤션을 깨지 않기 위한 의도.
 */
describe('UserRepository (real DB)', () => {
  let repo: UserRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [UserRepository],
    });
    repo = module.get(UserRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─────────────────────────────────────────────
  // findAccountWithProfile - withDeleted 플래그 contract
  //
  // 호출부(UserBaseService.requireActiveUser)가 항상 withDeleted:true로
  // 호출하기 때문에 서비스 spec으로는 falsy 브랜치가 검증되지 않는다.
  // soft-delete extension(applySoftDeleteArgs)이 where에 deleted_at own-key
  // 유무로 자동 필터 주입 여부를 분기하므로, 그 상호작용을 여기서 못박는다.
  // ─────────────────────────────────────────────
  describe('findAccountWithProfile - withDeleted flag', () => {
    it('withDeleted 미지정이면 soft-deleted 계정은 null로 반환된다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });
      await prisma.account.update({
        where: { id: account.id },
        data: { deleted_at: new Date() },
      });

      const result = await repo.findAccountWithProfile(account.id);

      expect(result).toBeNull();
    });

    it('withDeleted: true 이면 soft-deleted 계정도 그대로 반환된다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });
      const deletedAt = new Date();
      await prisma.account.update({
        where: { id: account.id },
        data: { deleted_at: deletedAt },
      });

      const result = await repo.findAccountWithProfile(account.id, {
        withDeleted: true,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(account.id);
      expect(result?.deleted_at).not.toBeNull();
    });
  });
});
