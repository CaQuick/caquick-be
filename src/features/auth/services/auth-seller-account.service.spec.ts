import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { SellerAccountService } from '@/features/auth/services/auth-seller-account.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createAccountCredential,
  createSellerProfile,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerAccountService (real DB)', () => {
  let service: SellerAccountService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerAccountService,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(SellerAccountService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function makeSeller(
    overrides: {
      name?: string | null;
      status?: 'ACTIVE' | 'SUSPENDED';
      mustChangePassword?: boolean;
    } = {},
  ) {
    const account = await createAccount(prisma, {
      account_type: 'SELLER',
      name: overrides.name,
      status: overrides.status,
    });
    const credential = await createAccountCredential(prisma, {
      account_id: account.id,
      must_change_password: overrides.mustChangePassword,
    });
    await createSellerProfile(prisma, {
      account_id: account.id,
      business_name: '케이베이커리',
    });
    return { account, credential };
  }

  describe('sellerMe', () => {
    it('자격증명·프로필·매장을 합쳐 전 필드를 반환한다', async () => {
      const { account, credential } = await makeSeller({ name: '김사장' });
      const store = await createStore(prisma, {
        seller_account_id: account.id,
      });

      const result = await service.sellerMe(account.id);

      expect(result).toEqual({
        accountId: account.id.toString(),
        username: credential.username,
        displayName: '김사장',
        storeId: store.id.toString(),
        mustChangePassword: false,
        accountStatus: 'ACTIVE',
      });
    });

    it('계정 이름이 없으면 사업자명을 displayName으로 쓴다', async () => {
      const { account } = await makeSeller({ name: null });

      const result = await service.sellerMe(account.id);

      expect(result.displayName).toBe('케이베이커리');
    });

    it('계정 이름도 프로필도 없으면 displayName은 null이다', async () => {
      const account = await createAccount(prisma, {
        account_type: 'SELLER',
        name: null,
      });

      const result = await service.sellerMe(account.id);

      expect(result.displayName).toBeNull();
      expect(result.username).toBeNull();
    });

    it('삭제된 자격증명은 없는 것으로 본다', async () => {
      const { account, credential } = await makeSeller({
        mustChangePassword: true,
      });
      await prisma.accountCredential.update({
        where: { id: credential.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.sellerMe(account.id);

      expect(result.username).toBeNull();
      expect(result.mustChangePassword).toBe(false);
    });

    it('삭제된 매장은 storeId null로 답한다', async () => {
      const { account } = await makeSeller();
      await createStore(prisma, {
        seller_account_id: account.id,
        deleted_at: new Date(),
      });

      const result = await service.sellerMe(account.id);

      expect(result.storeId).toBeNull();
    });

    it('매장이 없어도 STORE_NOT_FOUND가 아니라 storeId null로 답한다', async () => {
      const { account } = await makeSeller();

      const result = await service.sellerMe(account.id);

      expect(result.storeId).toBeNull();
      expect(result.accountId).toBe(account.id.toString());
    });

    it('초기 비밀번호 상태도 서비스는 답한다(차단은 RolesGuard 몫)', async () => {
      const { account } = await makeSeller({ mustChangePassword: true });

      const result = await service.sellerMe(account.id);

      expect(result.mustChangePassword).toBe(true);
    });

    it.each(['USER', 'ADMIN'] as const)(
      '%s 계정이면 SELLER_ONLY',
      async (accountType) => {
        const account = await createAccount(prisma, {
          account_type: accountType,
        });

        await expect(service.sellerMe(account.id)).rejects.toThrowDomain(
          'SELLER_ONLY',
        );
      },
    );

    it('정지된 계정이면 ACCOUNT_NOT_ACTIVE', async () => {
      const { account } = await makeSeller({ status: 'SUSPENDED' });

      await expect(service.sellerMe(account.id)).rejects.toThrowDomain(
        'ACCOUNT_NOT_ACTIVE',
      );
    });

    it('없는 계정이면 SESSION_ACCOUNT_MISSING', async () => {
      await expect(service.sellerMe(BigInt(999_999))).rejects.toThrowDomain(
        'SESSION_ACCOUNT_MISSING',
      );
    });

    it('탈퇴(soft-delete)한 계정이면 SESSION_ACCOUNT_MISSING', async () => {
      const account = await createAccount(prisma, {
        account_type: 'SELLER',
        deleted_at: new Date(),
      });

      await expect(service.sellerMe(account.id)).rejects.toThrowDomain(
        'SESSION_ACCOUNT_MISSING',
      );
    });
  });
});
