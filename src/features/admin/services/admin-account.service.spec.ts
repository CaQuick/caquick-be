import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminAccountService } from '@/features/admin/services/admin-account.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createAccountCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminAccountService (real DB)', () => {
  let service: AdminAccountService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminAccountService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
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
    it('존재하지 않는 계정이면 UnauthorizedException', async () => {
      await expect(service.adminMe(BigInt(999_999))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it.each(['USER', 'SELLER'] as const)(
      '%s 계정이면 ForbiddenException',
      async (accountType) => {
        const account = await createAccount(prisma, {
          account_type: accountType,
        });
        await expect(service.adminMe(account.id)).rejects.toThrow(
          ForbiddenException,
        );
      },
    );

    it('정지된 ADMIN 계정이면 ForbiddenException', async () => {
      const account = await createAccount(prisma, {
        account_type: 'ADMIN',
        status: 'SUSPENDED',
      });
      await expect(service.adminMe(account.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('탈퇴(soft-delete)한 ADMIN 계정이면 UnauthorizedException', async () => {
      const account = await createAccount(prisma, {
        account_type: 'ADMIN',
        deleted_at: new Date(),
      });
      await expect(service.adminMe(account.id)).rejects.toThrow(
        UnauthorizedException,
      );
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

    it('자격증명이 없는 ADMIN(개발용)은 username null로 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'ADMIN' });

      const result = await service.adminMe(account.id);

      expect(result.username).toBeNull();
      expect(result.mustChangePassword).toBe(false);
    });

    it('컨텍스트 통과 후 행이 사라졌으면 NotFoundException', async () => {
      const account = await createAccount(prisma, { account_type: 'ADMIN' });
      const repo = service['repo'];
      const spy = jest
        .spyOn(repo, 'findAdminAccountById')
        .mockResolvedValueOnce(null);
      await expect(service.adminMe(account.id)).rejects.toThrow(
        NotFoundException,
      );
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

    it('username 앞뒤 공백은 잘라 저장하고 email/name 빈 문자열은 null', async () => {
      const actor = await makeAdmin();

      const result = await service.adminCreateAdmin(actor, {
        ...validInput,
        username: '  spaced.admin  ',
        email: '   ',
        name: '',
      });

      expect(result.username).toBe('spaced.admin');
      expect(result.email).toBeNull();
      expect(result.name).toBeNull();
    });

    it('이미 쓰이는 username이면 BadRequestException', async () => {
      const actor = await makeAdmin({ username: 'taken.name' });

      await expect(
        service.adminCreateAdmin(actor, {
          ...validInput,
          username: 'taken.name',
        }),
      ).rejects.toThrow(BadRequestException);
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
      ).rejects.toThrow(BadRequestException);
    });

    it('사전 조회를 지나친 unique 충돌(P2002)도 BadRequestException으로 좁힌다', async () => {
      const actor = await makeAdmin();
      const repo = service['repo'];
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
      ).rejects.toThrow(BadRequestException);
      // 트랜잭션이 롤백돼 계정이 추가로 남지 않는다
      expect(
        await prisma.account.count({ where: { account_type: 'ADMIN' } }),
      ).toBe(2);
      spy.mockRestore();
    });
  });
});
