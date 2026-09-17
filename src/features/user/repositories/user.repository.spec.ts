import { buildWithdrawnProviderSubject } from '@/common/utils/withdrawn-identity';
import { UserRepository } from '@/features/user/repositories/user.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createAccountIdentity,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 서비스/리졸버 spec으로는 직접 도달이 어려운 API contract만 좁게 검증한다.
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

  // 호출부(UserBaseService.requireActiveUser)가 항상 withDeleted:true로 호출해 서비스 spec으로는 falsy 브랜치가 검증되지 않는다.
  // soft-delete extension이 where의 deleted_at own-key 유무로 자동 필터 주입을 분기하므로 그 상호작용을 여기서 못박는다.
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

  // 탈퇴 후 같은 소셜 계정으로 재가입할 수 있어야 하는데 (provider, provider_subject) UNIQUE는 soft-delete를 보지 않는다 — subject 익명화까지 일어나는지 못박는다.
  describe('softDeleteAccount - account_identity 은퇴', () => {
    it('연동된 identity를 soft-delete하고 provider_subject를 익명화한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });
      await createAccountIdentity(prisma, {
        account_id: account.id,
        provider: 'KAKAO',
        provider_subject: 'kakao-withdraw',
      });
      const now = new Date();

      await repo.softDeleteAccount({
        accountId: account.id,
        deletedNickname: `deleted_${account.id.toString()}`,
        now,
      });

      // deleted_at 을 명시해야 soft-delete extension 의 자동 필터를 우회한다
      const identity = await prisma.accountIdentity.findFirstOrThrow({
        where: { account_id: account.id, deleted_at: { not: null } },
      });
      expect(identity.deleted_at).toBeInstanceOf(Date);
      expect(identity.provider_subject).toBe(
        buildWithdrawnProviderSubject(account.id, 'kakao-withdraw'),
      );
      expect(identity.provider_subject).not.toContain('kakao-withdraw');
    });

    it('은퇴 처리 후 같은 provider+subject로 새 identity를 만들 수 있다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });
      await createAccountIdentity(prisma, {
        account_id: account.id,
        provider: 'GOOGLE',
        provider_subject: 'google-reuse',
      });

      await repo.softDeleteAccount({
        accountId: account.id,
        deletedNickname: `deleted_${account.id.toString()}`,
        now: new Date(),
      });

      const rejoined = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        createAccountIdentity(prisma, {
          account_id: rejoined.id,
          provider: 'GOOGLE',
          provider_subject: 'google-reuse',
        }),
      ).resolves.toBeDefined();
    });
  });
});
