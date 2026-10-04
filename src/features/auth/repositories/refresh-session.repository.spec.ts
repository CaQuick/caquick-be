import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { RefreshSessionRepository } from '@/features/auth/repositories/refresh-session.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createRefreshSession } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('RefreshSessionRepository (real DB)', () => {
  let repo: RefreshSessionRepository;
  let admins: AccountAdminRepository;
  let auditLogs: AuditLogRepository;
  let prisma: PrismaClient;
  let clock: ClockService;

  beforeAll(async () => {
    clock = new ClockService();
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        RefreshSessionRepository,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: ClockService, useValue: clock },
      ],
    });
    repo = module.get(RefreshSessionRepository);
    admins = module.get(AccountAdminRepository);
    auditLogs = module.get(AUDIT_LOG_REPOSITORY);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createRefreshSession', () => {
    it('refresh session을 생성한다', async () => {
      const account = await createAccount(prisma);
      const expiresAt = new Date(Date.now() + 3600_000);

      const session = await repo.createRefreshSession({
        accountId: account.id,
        tokenHash: 'a'.repeat(64),
        userAgent: 'test-agent',
        ipAddress: '1.2.3.4',
        expiresAt,
        credentialVersion: null,
      });

      expect(session.account_id).toBe(account.id);
      expect(session.token_hash).toBe('a'.repeat(64));
      expect(session.revoked_at).toBeNull();
    });

    it('userAgent/ipAddress 미지정 시 null로 저장된다', async () => {
      const account = await createAccount(prisma);

      const session = await repo.createRefreshSession({
        accountId: account.id,
        tokenHash: 'b'.repeat(64),
        expiresAt: new Date(Date.now() + 3600_000),
        credentialVersion: null,
      });

      expect(session.user_agent).toBeNull();
      expect(session.ip_address).toBeNull();
    });

    it('넘겨받은 자격증명 버전을 저장한다', async () => {
      const account = await createAccount(prisma);
      const version = new Date('2026-10-04T00:00:00.123Z');

      const session = await repo.createRefreshSession({
        accountId: account.id,
        tokenHash: 'v'.repeat(64),
        expiresAt: new Date(Date.now() + 3600_000),
        credentialVersion: version,
      });

      expect(session.credential_version).toEqual(version);
    });
  });

  describe('findActiveRefreshSessionByHash', () => {
    it('유효한 세션을 조회한다', async () => {
      const account = await createAccount(prisma);
      const tokenHash = 'b'.repeat(64);
      await createRefreshSession(prisma, {
        account_id: account.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 3600_000),
      });

      const found = await repo.findActiveRefreshSessionByHash(tokenHash);
      expect(found).not.toBeNull();
      expect(found!.token_hash).toBe(tokenHash);
    });

    it('만료된 세션은 조회하지 않는다', async () => {
      const account = await createAccount(prisma);
      const tokenHash = 'c'.repeat(64);
      await createRefreshSession(prisma, {
        account_id: account.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() - 1000),
      });

      const found = await repo.findActiveRefreshSessionByHash(tokenHash);
      expect(found).toBeNull();
    });

    it('revoke된 세션은 조회하지 않는다', async () => {
      const account = await createAccount(prisma);
      const tokenHash = 'd'.repeat(64);
      await createRefreshSession(prisma, {
        account_id: account.id,
        token_hash: tokenHash,
        revoked_at: new Date(),
      });

      const found = await repo.findActiveRefreshSessionByHash(tokenHash);
      expect(found).toBeNull();
    });
  });

  describe('rotateRefreshSession', () => {
    it('기존 세션을 revoke하고 새 세션을 생성한다', async () => {
      const account = await createAccount(prisma);
      const oldSession = await createRefreshSession(prisma, {
        account_id: account.id,
        token_hash: 'e'.repeat(64),
      });

      const newSession = await repo.rotateRefreshSession({
        currentSessionId: oldSession.id,
        accountId: account.id,
        newTokenHash: 'f'.repeat(64),
        newExpiresAt: new Date(Date.now() + 3600_000),
        credentialVersion: null,
      });

      expect(newSession.token_hash).toBe('f'.repeat(64));

      const revokedOld = await prisma.authRefreshSession.findUnique({
        where: { id: oldSession.id },
      });
      expect(revokedOld!.revoked_at).not.toBeNull();
      expect(revokedOld!.replaced_by_session_id).toBe(newSession.id);
    });

    it('userAgent/ipAddress 미지정 시 새 세션의 해당 필드는 null이다', async () => {
      const account = await createAccount(prisma);
      const oldSession = await createRefreshSession(prisma, {
        account_id: account.id,
        token_hash: 'j'.repeat(64),
      });

      const newSession = await repo.rotateRefreshSession({
        currentSessionId: oldSession.id,
        accountId: account.id,
        newTokenHash: 'k'.repeat(64),
        newExpiresAt: new Date(Date.now() + 3600_000),
        credentialVersion: null,
      });

      expect(newSession.user_agent).toBeNull();
      expect(newSession.ip_address).toBeNull();
    });

    it('새 세션에 넘겨받은 자격증명 버전을 저장한다', async () => {
      const account = await createAccount(prisma);
      const oldSession = await createRefreshSession(prisma, {
        account_id: account.id,
      });
      const version = new Date('2026-10-04T00:00:00.123Z');

      const newSession = await repo.rotateRefreshSession({
        currentSessionId: oldSession.id,
        accountId: account.id,
        newTokenHash: 'w'.repeat(64),
        newExpiresAt: new Date(Date.now() + 3600_000),
        credentialVersion: version,
      });

      expect(newSession.credential_version).toEqual(version);
    });
  });

  describe('revokeRefreshSession', () => {
    it('세션을 revoke 처리한다', async () => {
      const account = await createAccount(prisma);
      const session = await createRefreshSession(prisma, {
        account_id: account.id,
        token_hash: 'g'.repeat(64),
      });

      await repo.revokeRefreshSession(session.id);

      const found = await prisma.authRefreshSession.findUnique({
        where: { id: session.id },
      });
      expect(found!.revoked_at).not.toBeNull();
    });
  });

  describe('revokeAllRefreshSessions', () => {
    it('계정의 활성 세션을 모두 revoke한다', async () => {
      const account = await createAccount(prisma);
      await createRefreshSession(prisma, {
        account_id: account.id,
        token_hash: 'h'.repeat(64),
      });
      await createRefreshSession(prisma, {
        account_id: account.id,
        token_hash: 'i'.repeat(64),
      });

      await repo.revokeAllRefreshSessions(account.id, new Date());

      const active = await prisma.authRefreshSession.findMany({
        where: { account_id: account.id, revoked_at: null },
      });
      expect(active).toHaveLength(0);
    });
  });

  describe('ACTIVE 계정에만 발급·회전', () => {
    it.each(['SUSPENDED', 'PENDING'] as const)(
      '%s 계정에는 세션을 만들지 않는다(ForbiddenException)',
      async (status) => {
        const account = await createAccount(prisma, { status });
        await expect(
          repo.createRefreshSession({
            accountId: account.id,
            tokenHash: 'h'.repeat(64),
            expiresAt: new Date(Date.now() + 60_000),
            credentialVersion: null,
          }),
        ).rejects.toThrowDomain(403);
        expect(
          await prisma.authRefreshSession.count({
            where: { account_id: account.id },
          }),
        ).toBe(0);
      },
    );

    it('정지된 계정의 세션은 회전되지 않고 기존 세션도 그대로 남는다(정지 트랜잭션이 폐기할 몫)', async () => {
      const account = await createAccount(prisma, { status: 'ACTIVE' });
      const session = await createRefreshSession(prisma, {
        account_id: account.id,
      });
      await prisma.account.update({
        where: { id: account.id },
        data: { status: 'SUSPENDED' },
      });

      await expect(
        repo.rotateRefreshSession({
          currentSessionId: session.id,
          accountId: account.id,
          newTokenHash: 'n'.repeat(64),
          newExpiresAt: new Date(Date.now() + 60_000),
          credentialVersion: null,
        }),
      ).rejects.toThrowDomain(403);
      expect(
        await prisma.authRefreshSession.count({
          where: { account_id: account.id },
        }),
      ).toBe(1);
      const same = await prisma.authRefreshSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(same.revoked_at).toBeNull();
    });

    /** 이 워커 DB에서 행 잠금을 기다리는 트랜잭션이 생길 때까지. */
    async function waitForLockWait(): Promise<void> {
      for (let i = 0; i < 250; i++) {
        const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*) AS n FROM information_schema.innodb_trx t
          JOIN information_schema.processlist p ON p.id = t.trx_mysql_thread_id
          WHERE t.trx_state = 'LOCK WAIT' AND p.db = DATABASE()`;
        if (n > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('잠금 대기가 관측되지 않았다');
    }

    // 정지 트랜잭션이 계정 행을 잡은 채(전 세션 폐기 뒤, 커밋 전) 발급이 끼어든다
    it('정지 트랜잭션과 겹친 발급은 잠금을 기다렸다가 거절된다 — 정지된 계정에 살아 있는 세션이 남지 않는다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      let issuing: Promise<unknown> | undefined;
      const recordAudit = auditLogs.recordAudit.bind(auditLogs);
      jest
        .spyOn(auditLogs, 'recordAudit')
        .mockImplementationOnce(async (tx, entry) => {
          issuing = repo
            .createRefreshSession({
              accountId: account.id,
              tokenHash: 'r'.repeat(64),
              expiresAt: new Date(Date.now() + 60_000),
              credentialVersion: null,
            })
            .then(
              () => null,
              (error: unknown) => error,
            );
          await waitForLockWait();
          return recordAudit(tx, entry);
        });

      await admins.updateAccountStatus({
        accountId: account.id,
        from: 'ACTIVE',
        to: 'SUSPENDED',
        revokeSessions: true,
        invalidTransitionCode: 'ONLY_ACTIVE_CAN_BE_SUSPENDED',
        audit: {
          actorAccountId: account.id,
          storeId: null,
          targetType: 'ACCOUNT',
          targetId: account.id,
          action: 'STATUS_CHANGE',
        },
      });

      expect(await issuing).toThrowDomain('ACCOUNT_NOT_ACTIVE');
      expect(
        await prisma.authRefreshSession.count({
          where: { account_id: account.id, revoked_at: null },
        }),
      ).toBe(0);
    });
  });
});
