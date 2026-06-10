import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { RefreshSessionRepository } from '@/features/auth/repositories/refresh-session.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createRefreshSession } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('RefreshSessionRepository (real DB)', () => {
  let repo: RefreshSessionRepository;
  let prisma: PrismaClient;
  let clock: ClockService;

  beforeAll(async () => {
    clock = new ClockService();
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        RefreshSessionRepository,
        { provide: ClockService, useValue: clock },
      ],
    });
    repo = module.get(RefreshSessionRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
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
      });

      expect(session.user_agent).toBeNull();
      expect(session.ip_address).toBeNull();
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
      });

      expect(newSession.user_agent).toBeNull();
      expect(newSession.ip_address).toBeNull();
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
});
