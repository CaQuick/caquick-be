import type { PrismaClient } from '@prisma/client';

import { SellerCredentialRepository } from '@/features/auth/repositories/seller-credential.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createSellerCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerCredentialRepository (real DB)', () => {
  let repo: SellerCredentialRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SellerCredentialRepository],
    });
    repo = module.get(SellerCredentialRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('findSellerCredentialByUsername', () => {
    it('username으로 판매자 자격정보를 조회한다', async () => {
      const sellerAccount = await createAccount(prisma, {
        account_type: 'SELLER',
      });
      await createSellerCredential(prisma, {
        seller_account_id: sellerAccount.id,
        username: 'test_seller',
      });

      const found = await repo.findSellerCredentialByUsername('test_seller');

      expect(found).not.toBeNull();
      expect(found!.username).toBe('test_seller');
      expect(found!.seller_account.id).toBe(sellerAccount.id);
    });

    it('존재하지 않는 username이면 null', async () => {
      const found = await repo.findSellerCredentialByUsername('nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('findSellerCredentialByAccountId', () => {
    it('accountId로 판매자 자격정보를 조회한다', async () => {
      const sellerAccount = await createAccount(prisma, {
        account_type: 'SELLER',
      });
      await createSellerCredential(prisma, {
        seller_account_id: sellerAccount.id,
      });

      const found = await repo.findSellerCredentialByAccountId(
        sellerAccount.id,
      );

      expect(found).not.toBeNull();
      expect(found!.seller_account_id).toBe(sellerAccount.id);
    });
  });

  describe('updateSellerLastLogin', () => {
    it('최근 로그인 시각을 갱신한다', async () => {
      const sellerAccount = await createAccount(prisma, {
        account_type: 'SELLER',
      });
      await createSellerCredential(prisma, {
        seller_account_id: sellerAccount.id,
      });

      const now = new Date();
      await repo.updateSellerLastLogin(sellerAccount.id, now);

      const updated = await prisma.sellerCredential.findUnique({
        where: { seller_account_id: sellerAccount.id },
      });
      expect(updated!.last_login_at!.getTime()).toBe(now.getTime());
    });
  });

  describe('updateSellerPasswordHash', () => {
    it('비밀번호 해시를 갱신한다', async () => {
      const sellerAccount = await createAccount(prisma, {
        account_type: 'SELLER',
      });
      await createSellerCredential(prisma, {
        seller_account_id: sellerAccount.id,
      });

      const now = new Date();
      await repo.updateSellerPasswordHash({
        sellerAccountId: sellerAccount.id,
        passwordHash: 'new_hash_value',
        now,
      });

      const updated = await prisma.sellerCredential.findUnique({
        where: { seller_account_id: sellerAccount.id },
      });
      expect(updated!.password_hash).toBe('new_hash_value');
    });
  });
});
