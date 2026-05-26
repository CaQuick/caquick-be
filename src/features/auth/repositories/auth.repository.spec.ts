import type { PrismaClient } from '@prisma/client';
import {
  AuditActionType,
  AuditTargetType,
  IdentityProvider,
} from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { AuthRepository } from '@/features/auth/repositories/auth.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createAccountIdentity,
  createSellerCredential,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AuthRepository (real DB)', () => {
  let repo: AuthRepository;
  let prisma: PrismaClient;
  let clock: ClockService;

  beforeAll(async () => {
    clock = new ClockService();
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [AuthRepository, { provide: ClockService, useValue: clock }],
    });
    repo = module.get(AuthRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Identity 조회 ───

  describe('findIdentityByProviderSubject', () => {
    it('provider+subject로 Identity를 조회한다', async () => {
      const account = await createAccount(prisma);
      await createAccountIdentity(prisma, {
        account_id: account.id,
        provider: 'GOOGLE',
        provider_subject: 'google-sub-123',
      });

      const result = await repo.findIdentityByProviderSubject(
        IdentityProvider.GOOGLE,
        'google-sub-123',
      );

      expect(result).not.toBeNull();
      expect(result!.provider_subject).toBe('google-sub-123');
      expect(result!.account.id).toBe(account.id);
    });

    it('존재하지 않으면 null을 반환한다', async () => {
      const result = await repo.findIdentityByProviderSubject(
        IdentityProvider.GOOGLE,
        'nonexistent',
      );
      expect(result).toBeNull();
    });
  });

  // ─── 이메일 계정 조회 ───

  describe('findAccountByEmail', () => {
    it('이메일로 계정을 조회한다', async () => {
      const account = await createAccount(prisma, {
        email: 'test@example.com',
      });
      await createUserProfile(prisma, { account_id: account.id });

      const result = await repo.findAccountByEmail('test@example.com');

      expect(result).not.toBeNull();
      expect(result!.id).toBe(account.id);
      expect(result!.user_profile).not.toBeNull();
    });

    it('존재하지 않는 이메일이면 null을 반환한다', async () => {
      const result = await repo.findAccountByEmail('nobody@example.com');
      expect(result).toBeNull();
    });
  });

  // ─── OIDC Identity Upsert ───

  describe('upsertUserByOidcIdentity', () => {
    it('신규 Identity+계정을 생성한다', async () => {
      const result = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'new-sub',
        providerEmail: 'new@example.com',
        emailVerified: true,
        providerDisplayName: 'New User',
      });

      expect(result.account).not.toBeNull();
      expect(result.account!.email).toBe('new@example.com');
      expect(result.account!.user_profile).not.toBeNull();
      expect(result.account!.user_profile!.nickname).toBe('New User');
    });

    it('기존 Identity가 있으면 업데이트한다', async () => {
      const account = await createAccount(prisma, { email: 'old@example.com' });
      await createUserProfile(prisma, { account_id: account.id });
      await createAccountIdentity(prisma, {
        account_id: account.id,
        provider: 'GOOGLE',
        provider_subject: 'existing-sub',
      });

      const result = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'existing-sub',
        providerEmail: 'updated@example.com',
        emailVerified: true,
        providerDisplayName: 'Updated',
      });

      // 기존 계정의 email은 이미 있으므로 유지
      expect(result.account!.email).toBe('old@example.com');
    });

    it('이메일 미인증이면 계정 email을 null로 설정한다', async () => {
      const result = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.KAKAO,
        providerSubject: 'kakao-sub',
        providerEmail: 'unverified@example.com',
        emailVerified: false,
      });

      expect(result.account!.email).toBeNull();
    });

    it('displayName 없으면 email 앞부분으로 nickname을 생성한다', async () => {
      const result = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'no-name-sub',
        providerEmail: 'john@example.com',
        emailVerified: true,
      });

      expect(result.account!.user_profile!.nickname).toBe('john');
    });

    it('displayName/email 모두 없으면 nickname이 "user"로 생성된다', async () => {
      const result = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.KAKAO,
        providerSubject: 'anonymous-sub',
        emailVerified: false,
      });

      expect(result.account!.user_profile!.nickname).toBe('user');
    });

    it('기존 Identity + account email이 null + user_profile 없는 경우: profile 신규 생성 + email 주입', async () => {
      // account는 있지만 email/profile이 비어있는 초기 상태 재현
      const account = await prisma.account.create({
        data: {
          account_type: 'USER',
          email: null,
          name: null,
          status: 'ACTIVE',
        },
      });
      await createAccountIdentity(prisma, {
        account_id: account.id,
        provider: 'GOOGLE',
        provider_subject: 'partial-sub',
      });

      const result = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'partial-sub',
        providerEmail: 'new-profile@example.com',
        emailVerified: true,
        providerDisplayName: 'New Name',
      });

      expect(result.account!.email).toBe('new-profile@example.com');
      expect(result.account!.name).toBe('New Name');
      expect(result.account!.user_profile).not.toBeNull();
    });
  });

  // ─── JWT/Me 조회 ───

  describe('findAccountForJwt', () => {
    it('계정 id/status/type을 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });

      const found = await repo.findAccountForJwt(account.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(account.id);
      expect(found!.status).toBe('ACTIVE');
      expect(found!.account_type).toBe('USER');
    });
  });

  describe('findAccountForMe', () => {
    it('계정 + user_profile을 반환한다', async () => {
      const account = await createAccount(prisma);
      await createUserProfile(prisma, { account_id: account.id });

      const found = await repo.findAccountForMe(account.id);

      expect(found).not.toBeNull();
      expect(found!.user_profile).not.toBeNull();
    });
  });

  // ─── Seller 조회 ───

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

  // ─── Audit Log ───

  describe('createAuditLog', () => {
    it('감사 로그를 생성한다', async () => {
      const account = await createAccount(prisma);

      await repo.createAuditLog({
        actorAccountId: account.id,
        targetType: AuditTargetType.CHANGE_PASSWORD,
        targetId: account.id,
        action: AuditActionType.UPDATE,
        beforeJson: null,
        afterJson: { changed: true },
        ipAddress: '1.2.3.4',
        userAgent: 'test',
      });

      const logs = await prisma.auditLog.findMany({
        where: { actor_account_id: account.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe(AuditActionType.UPDATE);
    });

    it('storeId/ipAddress/userAgent/beforeJson 모두 생략해도 기본 null 처리로 생성된다', async () => {
      const account = await createAccount(prisma);

      await repo.createAuditLog({
        actorAccountId: account.id,
        targetType: AuditTargetType.STORE,
        targetId: account.id,
        action: AuditActionType.UPDATE,
      });

      const logs = await prisma.auditLog.findMany({
        where: { actor_account_id: account.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].store_id).toBeNull();
      expect(logs[0].ip_address).toBeNull();
      expect(logs[0].user_agent).toBeNull();
      expect(logs[0].before_json).toBeNull();
      expect(logs[0].after_json).toBeNull();
    });
  });
});
