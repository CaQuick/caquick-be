import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountCredentialRepository } from '@/features/auth/repositories/account-credential.repository';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createAccountCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/** repository가 조작과 같은 트랜잭션에 남기는 감사 항목. */
const AUDIT_ENTRY = {
  actorAccountId: 1n,
  storeId: null,
  targetType: AuditTargetType.CHANGE_PASSWORD,
  targetId: 1n,
  action: AuditActionType.UPDATE,
};

describe('AccountCredentialRepository (real DB)', () => {
  let repo: AccountCredentialRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AccountCredentialRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    repo = module.get(AccountCredentialRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('findCredentialByUsername', () => {
    it('username으로 자격증명과 계정 요약을 조회한다', async () => {
      const sellerAccount = await createAccount(prisma, {
        account_type: 'SELLER',
      });
      await createAccountCredential(prisma, {
        account_id: sellerAccount.id,
        username: 'test_seller',
      });

      const found = await repo.findCredentialByUsername('test_seller');

      expect(found).not.toBeNull();
      expect(found!.username).toBe('test_seller');
      expect(found!.account.id).toBe(sellerAccount.id);
      expect(found!.account.account_type).toBe('SELLER');
    });

    it('ADMIN 자격증명도 같은 경로로 조회된다', async () => {
      const admin = await createAccount(prisma, { account_type: 'ADMIN' });
      await createAccountCredential(prisma, {
        account_id: admin.id,
        username: 'root_admin',
        must_change_password: true,
      });

      const found = await repo.findCredentialByUsername('root_admin');

      expect(found!.account.account_type).toBe('ADMIN');
      expect(found!.must_change_password).toBe(true);
    });

    it('존재하지 않는 username이면 null', async () => {
      const found = await repo.findCredentialByUsername('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findCredentialByAccountId', () => {
    it('accountId로 자격증명을 조회한다', async () => {
      const sellerAccount = await createAccount(prisma, {
        account_type: 'SELLER',
      });
      await createAccountCredential(prisma, { account_id: sellerAccount.id });

      const found = await repo.findCredentialByAccountId(sellerAccount.id);

      expect(found).not.toBeNull();
      expect(found!.account_id).toBe(sellerAccount.id);
    });
  });

  describe('updateLastLogin', () => {
    it('최근 로그인 시각을 갱신한다', async () => {
      const sellerAccount = await createAccount(prisma, {
        account_type: 'SELLER',
      });
      await createAccountCredential(prisma, { account_id: sellerAccount.id });

      const now = new Date();
      await repo.updateLastLogin(sellerAccount.id, now);

      const updated = await prisma.accountCredential.findUnique({
        where: { account_id: sellerAccount.id },
      });
      expect(updated!.last_login_at!.getTime()).toBe(now.getTime());
    });
  });

  describe('updatePasswordHash', () => {
    it('비밀번호 해시를 갱신하고 must_change_password를 해제한다', async () => {
      const sellerAccount = await createAccount(prisma, {
        account_type: 'SELLER',
      });
      await createAccountCredential(prisma, {
        account_id: sellerAccount.id,
        must_change_password: true,
      });

      const session = await prisma.authRefreshSession.create({
        data: {
          account_id: sellerAccount.id,
          token_hash: 'hash',
          expires_at: new Date(Date.now() + 86_400_000),
        },
      });

      const now = new Date();
      await repo.changePassword(
        {
          accountId: sellerAccount.id,
          passwordHash: 'new_hash_value',
          now,
        },
        () => AUDIT_ENTRY,
      );

      const updated = await prisma.accountCredential.findUnique({
        where: { account_id: sellerAccount.id },
      });
      expect(updated!.password_hash).toBe('new_hash_value');
      expect(updated!.password_updated_at!.getTime()).toBe(now.getTime());
      expect(updated!.must_change_password).toBe(false);
      // 같은 트랜잭션에서 전 세션을 끊고 감사를 남긴다(P1-12)
      expect(
        (
          await prisma.authRefreshSession.findUniqueOrThrow({
            where: { id: session.id },
          })
        ).revoked_at,
      ).not.toBeNull();
      expect(await prisma.auditLog.count()).toBe(1);
    });
  });
});
