import argon2 from 'argon2';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { AdminAccountService } from '@/features/auth/services/auth-admin-account.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { TokenBlacklistService } from '@/global/auth';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createAccountCredential,
  createRefreshSession,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminAccountService (real DB)', () => {
  let service: AdminAccountService;
  let prisma: PrismaClient;
  const blacklist = {
    blockCredentials: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminAccountService,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: TokenBlacklistService, useValue: blacklist },
      ],
    });
    service = module.get(AdminAccountService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    blacklist.blockCredentials.mockClear();
  });

  async function makeAdmin(overrides: { username?: string } = {}) {
    const credential = await createAccountCredential(prisma, {
      account_type: 'ADMIN',
      username: overrides.username,
    });
    return credential.account_id;
  }

  const validInput = {
    username: 'new.admin_1',
    password: 'Strong!Pass1',
    email: 'new@example.com',
    name: '신규 관리자',
  };

  describe('requireAdminContext (공통)', () => {
    it('존재하지 않는 계정이면 401', async () => {
      await expect(service.adminMe(BigInt(999_999))).rejects.toThrowDomain(401);
    });

    it.each(['USER', 'SELLER'] as const)(
      '%s 계정이면 403',
      async (accountType) => {
        const account = await createAccount(prisma, {
          account_type: accountType,
        });
        await expect(service.adminMe(account.id)).rejects.toThrowDomain(403);
      },
    );

    it('정지된 ADMIN 계정이면 403', async () => {
      const account = await createAccount(prisma, {
        account_type: 'ADMIN',
        status: 'SUSPENDED',
      });
      await expect(service.adminMe(account.id)).rejects.toThrowDomain(403);
    });

    it('탈퇴(soft-delete)한 ADMIN 계정이면 401', async () => {
      const account = await createAccount(prisma, {
        account_type: 'ADMIN',
        deleted_at: new Date(),
      });
      await expect(service.adminMe(account.id)).rejects.toThrowDomain(401);
    });
  });

  describe('adminMe', () => {
    it('자격증명 정보를 합쳐 반환한다', async () => {
      const credential = await createAccountCredential(prisma, {
        account_type: 'ADMIN',
        username: 'root.admin',
        must_change_password: true,
      });

      const result = await service.adminMe(credential.account_id);

      expect(result.accountId).toBe(credential.account_id.toString());
      expect(result.username).toBe('root.admin');
      expect(result.mustChangePassword).toBe(true);
      expect(result.status).toBe('ACTIVE');
      expect(result.lastLoginAt).toBeNull();
    });

    it('삭제된 자격증명은 없는 것으로 본다', async () => {
      const credential = await createAccountCredential(prisma, {
        account_type: 'ADMIN',
        must_change_password: true,
      });
      await prisma.accountCredential.update({
        where: { id: credential.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.adminMe(credential.account_id);

      expect(result.username).toBeNull();
      expect(result.mustChangePassword).toBe(false);
    });

    it('자격증명이 없는 ADMIN(개발용)은 username null로 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'ADMIN' });

      const result = await service.adminMe(account.id);

      expect(result.username).toBeNull();
      expect(result.mustChangePassword).toBe(false);
    });

    it('컨텍스트 통과 후 행이 사라졌으면 404', async () => {
      const account = await createAccount(prisma, { account_type: 'ADMIN' });
      const repo = service['accounts'];
      const spy = jest
        .spyOn(repo, 'findAdminAccountById')
        .mockResolvedValueOnce(null);
      await expect(service.adminMe(account.id)).rejects.toThrowDomain(404);
      spy.mockRestore();
    });
  });

  describe('adminAdmins', () => {
    it('ADMIN 계정만 최신 생성순으로 반환하고 totalCount를 센다', async () => {
      const first = await makeAdmin();
      const second = await makeAdmin();
      await createAccount(prisma, { account_type: 'SELLER' });
      await createAccount(prisma, { account_type: 'USER' });

      const result = await service.adminAdmins(first);

      expect(result.totalCount).toBe(2);
      expect(result.items.map((i) => i.accountId)).toEqual([
        second.toString(),
        first.toString(),
      ]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('limit+1 조회로 hasMore·nextCursor를 판정하고 두 번째 페이지가 이어진다', async () => {
      const ids = [await makeAdmin(), await makeAdmin(), await makeAdmin()];

      const page1 = await service.adminAdmins(ids[0], { limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(ids[1].toString());

      const page2 = await service.adminAdmins(ids[0], {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((i) => i.accountId)).toEqual([ids[0].toString()]);
      expect(page2.hasMore).toBe(false);
    });

    it('탈퇴한 관리자는 목록·집계에서 빠진다', async () => {
      const actor = await makeAdmin();
      await createAccount(prisma, {
        account_type: 'ADMIN',
        deleted_at: new Date(),
      });

      const result = await service.adminAdmins(actor);

      expect(result.totalCount).toBe(1);
      expect(result.items).toHaveLength(1);
    });
  });

  describe('adminCreateAdmin', () => {
    it('계정+자격증명을 만들고 변경 강제 플래그를 켜며 audit(ACCOUNT/CREATE)을 남긴다', async () => {
      const actor = await makeAdmin();

      const result = await service.adminCreateAdmin(actor, validInput);

      expect(result.username).toBe('new.admin_1');
      expect(result.mustChangePassword).toBe(true);
      expect(result.status).toBe('ACTIVE');
      expect(result.email).toBe('new@example.com');

      const credential = await prisma.accountCredential.findUniqueOrThrow({
        where: { username: 'new.admin_1' },
      });
      expect(
        await argon2.verify(credential.password_hash, 'Strong!Pass1'),
      ).toBe(true);
      const account = await prisma.account.findUniqueOrThrow({
        where: { id: credential.account_id },
      });
      expect(account.account_type).toBe('ADMIN');

      const audit = await prisma.auditLog.findFirst({
        where: { target_type: 'ACCOUNT', target_id: credential.account_id },
      });
      expect(audit).toMatchObject({
        actor_account_id: actor,
        store_id: null,
        action: 'CREATE',
      });
    });

    it('email/name 빈 문자열은 null로 저장한다', async () => {
      const actor = await makeAdmin();

      const result = await service.adminCreateAdmin(actor, {
        ...validInput,
        email: '   ',
        name: '',
      });

      expect(result.email).toBeNull();
      expect(result.name).toBeNull();
    });

    it('감사 기록이 실패하면 계정·자격증명도 롤백된다(같은 트랜잭션)', async () => {
      const actor = await makeAdmin();
      const auditLogs = service['auditLogs'];
      const spy = jest
        .spyOn(auditLogs, 'recordAudit')
        .mockRejectedValueOnce(new Error('audit down'));

      await expect(service.adminCreateAdmin(actor, validInput)).rejects.toThrow(
        'audit down',
      );
      expect(
        await prisma.accountCredential.findUnique({
          where: { username: validInput.username },
        }),
      ).toBeNull();
      expect(
        await prisma.account.count({ where: { account_type: 'ADMIN' } }),
      ).toBe(1);
      spy.mockRestore();
    });

    it('이미 쓰이는 username이면 400', async () => {
      const actor = await makeAdmin({ username: 'taken.name' });

      await expect(
        service.adminCreateAdmin(actor, {
          ...validInput,
          username: 'taken.name',
        }),
      ).rejects.toThrowDomain(400);
    });

    it('판매자가 쓰는 username도 충돌한다(자격증명 테이블 공용)', async () => {
      const actor = await makeAdmin();
      await createAccountCredential(prisma, {
        account_type: 'SELLER',
        username: 'seller.name',
      });

      await expect(
        service.adminCreateAdmin(actor, {
          ...validInput,
          username: 'seller.name',
        }),
      ).rejects.toThrowDomain(400);
    });

    it('사전 조회를 지나친 unique 충돌(P2002)도 400으로 좁힌다', async () => {
      const actor = await makeAdmin();
      const repo = service['accounts'];
      const spy = jest
        .spyOn(repo, 'existsCredentialUsername')
        .mockResolvedValueOnce(false);
      await createAccountCredential(prisma, {
        account_type: 'ADMIN',
        username: 'race.name',
      });

      await expect(
        service.adminCreateAdmin(actor, {
          ...validInput,
          username: 'race.name',
        }),
      ).rejects.toThrowDomain(400);
      // 트랜잭션이 롤백돼 계정이 추가로 남지 않는다
      expect(
        await prisma.account.count({ where: { account_type: 'ADMIN' } }),
      ).toBe(2);
      spy.mockRestore();
    });
  });

  describe('adminResetAdminPassword', () => {
    const OLD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$mock_salt$mock_hash';

    it('비밀번호를 교체하고 변경을 강제하며 세션을 전부 폐기하고 audit을 남긴 뒤 블랙리스트에 등록한다', async () => {
      const actor = await makeAdmin();
      const target = await makeAdmin();
      const session = await createRefreshSession(prisma, {
        account_id: target,
      });

      const ok = await service.adminResetAdminPassword(actor, {
        accountId: target.toString(),
        newPassword: 'Reset!Pass9',
      });

      expect(ok).toBe(true);
      const credential = await prisma.accountCredential.findUniqueOrThrow({
        where: { account_id: target },
      });
      expect(await argon2.verify(credential.password_hash, 'Reset!Pass9')).toBe(
        true,
      );
      expect(credential.must_change_password).toBe(true);
      expect(credential.password_updated_at).not.toBeNull();
      // cutoff = DB에 기록한 변경 시각
      expect(blacklist.blockCredentials).toHaveBeenCalledTimes(1);
      expect(blacklist.blockCredentials).toHaveBeenCalledWith(
        target,
        credential.password_updated_at,
      );
      const revoked = await prisma.authRefreshSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(revoked.revoked_at).not.toBeNull();
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'ACCOUNT', target_id: target, action: 'UPDATE' },
      });
      expect(audit).toMatchObject({ actor_account_id: actor, store_id: null });
      expect(audit.after_json).toEqual({
        passwordReset: true,
        mustChangePassword: true,
      });
    });

    it('본인 계정이면 403이고 비밀번호·세션·감사가 그대로다', async () => {
      const actor = await makeAdmin();
      const session = await createRefreshSession(prisma, {
        account_id: actor,
      });

      await expect(
        service.adminResetAdminPassword(actor, {
          accountId: actor.toString(),
          newPassword: 'Reset!Pass9',
        }),
      ).rejects.toThrowDomain('CANNOT_RESET_OWN_PASSWORD');

      const credential = await prisma.accountCredential.findUniqueOrThrow({
        where: { account_id: actor },
      });
      expect(credential.password_hash).toBe(OLD_HASH);
      expect(credential.must_change_password).toBe(false);
      expect(credential.password_updated_at).toBeNull();
      const kept = await prisma.authRefreshSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(kept.revoked_at).toBeNull();
      expect(await prisma.auditLog.count()).toBe(0);
      expect(blacklist.blockCredentials).not.toHaveBeenCalled();
    });

    it.each([
      [
        '자격증명 없는 ADMIN(개발용)',
        async () => (await createAccount(prisma, { account_type: 'ADMIN' })).id,
      ],
      [
        '자격증명이 삭제된 ADMIN',
        async () => {
          const credential = await createAccountCredential(prisma, {
            account_type: 'ADMIN',
          });
          await prisma.accountCredential.update({
            where: { id: credential.id },
            data: { deleted_at: new Date() },
          });
          return credential.account_id;
        },
      ],
      [
        'SELLER 계정',
        async () =>
          (await createAccountCredential(prisma, { account_type: 'SELLER' }))
            .account_id,
      ],
      [
        'USER 계정',
        async () =>
          (await createAccountCredential(prisma, { account_type: 'USER' }))
            .account_id,
      ],
      [
        '탈퇴(soft-delete)한 ADMIN',
        async () => {
          const credential = await createAccountCredential(prisma, {
            account_type: 'ADMIN',
          });
          await prisma.account.update({
            where: { id: credential.account_id },
            data: { deleted_at: new Date() },
          });
          return credential.account_id;
        },
      ],
      ['없는 계정', () => Promise.resolve(BigInt(999_999))],
    ])('%s이면 404이고 아무것도 바꾸지 않는다', async (_label, makeId) => {
      const actor = await makeAdmin();
      const targetId = await makeId();

      await expect(
        service.adminResetAdminPassword(actor, {
          accountId: targetId.toString(),
          newPassword: 'Reset!Pass9',
        }),
      ).rejects.toThrowDomain('ACCOUNT_NOT_FOUND');

      expect(
        await prisma.accountCredential.count({
          where: { password_updated_at: { not: null } },
        }),
      ).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
      expect(blacklist.blockCredentials).not.toHaveBeenCalled();
    });

    it('감사 기록이 실패하면 비밀번호·세션 변경도 롤백되고 블랙리스트에 등록하지 않는다', async () => {
      const actor = await makeAdmin();
      const target = await makeAdmin();
      const session = await createRefreshSession(prisma, {
        account_id: target,
      });
      const spy = jest
        .spyOn(service['auditLogs'], 'recordAudit')
        .mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.adminResetAdminPassword(actor, {
          accountId: target.toString(),
          newPassword: 'Reset!Pass9',
        }),
      ).rejects.toThrow('audit down');

      const credential = await prisma.accountCredential.findUniqueOrThrow({
        where: { account_id: target },
      });
      expect(credential.password_hash).toBe(OLD_HASH);
      expect(credential.must_change_password).toBe(false);
      const kept = await prisma.authRefreshSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(kept.revoked_at).toBeNull();
      expect(blacklist.blockCredentials).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
