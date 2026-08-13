import { ConflictException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { IdentityProvider } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { AccountRepository } from '@/features/auth/repositories/account.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createAccountIdentity,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AccountRepository (real DB)', () => {
  let repo: AccountRepository;
  let prisma: PrismaClient;
  let clock: ClockService;

  beforeAll(async () => {
    clock = new ClockService();
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AccountRepository,
        { provide: ClockService, useValue: clock },
      ],
    });
    repo = module.get(AccountRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

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

    it('계정이 탈퇴 상태면 Identity가 살아 있어도 제외한다', async () => {
      // nested include 에는 soft-delete 필터가 주입되지 않아 직접 명시해야 한다
      const account = await createAccount(prisma, { deleted_at: new Date() });
      await createAccountIdentity(prisma, {
        account_id: account.id,
        provider: 'GOOGLE',
        provider_subject: 'withdrawn-account-sub',
      });

      const result = await repo.findIdentityByProviderSubject(
        IdentityProvider.GOOGLE,
        'withdrawn-account-sub',
      );

      expect(result).toBeNull();
    });
  });

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
      // 공백 제거 + accountId suffix (이전엔 'New User' 가 공백째 저장되던 회귀)
      expect(result.account!.user_profile!.nickname).toBe(
        `NewUser_${result.account!.id}`,
      );
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

      expect(result.account!.user_profile!.nickname).toBe(
        `john_${result.account!.id}`,
      );
    });

    it('displayName/email 모두 없으면 nickname이 "user"로 생성된다', async () => {
      const result = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.KAKAO,
        providerSubject: 'anonymous-sub',
        emailVerified: false,
      });

      expect(result.account!.user_profile!.nickname).toBe(
        `user_${result.account!.id}`,
      );
    });

    it('기존 Identity + 미인증 이메일이면 account email을 백필하지 않는다', async () => {
      // 카카오처럼 email_verified 를 주지 않는 provider 의 2회차 로그인 재현.
      // 예전에는 이 경로만 emailVerified 를 보지 않고 백필해 unique 충돌 500 을 냈다.
      const account = await createAccount(prisma, { email: null });
      await createUserProfile(prisma, { account_id: account.id });
      await createAccountIdentity(prisma, {
        account_id: account.id,
        provider: 'KAKAO',
        provider_subject: 'kakao-relogin',
      });

      const result = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.KAKAO,
        providerSubject: 'kakao-relogin',
        providerEmail: 'unverified@example.com',
        emailVerified: false,
      });

      expect(result.account!.email).toBeNull();
    });

    it('provider가 다른 계정이 같은 이메일을 각각 가질 수 있다(계정 통합 없음)', async () => {
      const google = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'google-shared',
        providerEmail: 'shared@example.com',
        emailVerified: true,
      });

      const kakao = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.KAKAO,
        providerSubject: 'kakao-shared',
        providerEmail: 'shared@example.com',
        emailVerified: true,
      });

      expect(google.account!.id).not.toBe(kakao.account!.id);
      expect(google.account!.email).toBe('shared@example.com');
      expect(kakao.account!.email).toBe('shared@example.com');
    });

    it('탈퇴 계정의 Identity가 남아 있으면 복구하지 않고 재가입시킨다', async () => {
      // 탈퇴 처리 이전 데이터(identity 가 살아있는 상태) 재현.
      const withdrawn = await createAccount(prisma, {
        email: null,
        deleted_at: new Date(),
      });
      await createAccountIdentity(prisma, {
        account_id: withdrawn.id,
        provider: 'GOOGLE',
        provider_subject: 'rejoin-sub',
      });

      const result = await repo.upsertUserByOidcIdentity({
        provider: IdentityProvider.GOOGLE,
        providerSubject: 'rejoin-sub',
        providerEmail: 'rejoin@example.com',
        emailVerified: true,
      });

      // 새 계정으로 가입된다
      expect(result.account).not.toBeNull();
      expect(result.account!.id).not.toBe(withdrawn.id);
      expect(result.account!.deleted_at).toBeNull();
      expect(result.account!.user_profile).not.toBeNull();

      // 옛 identity 는 익명화 + soft-delete 되어 자리를 비운다
      // (deleted_at 을 명시해야 soft-delete extension 의 자동 필터를 우회한다)
      const retired = await prisma.accountIdentity.findFirstOrThrow({
        where: { account_id: withdrawn.id, deleted_at: { not: null } },
      });
      expect(retired.deleted_at).toBeInstanceOf(Date);
      expect(retired.provider_subject).toBe(
        `withdrawn:${withdrawn.id.toString()}:rejoin-sub`,
      );

      // 새 identity 가 원본 subject 를 넘겨받는다
      const active = await prisma.accountIdentity.findFirstOrThrow({
        where: { account_id: result.account!.id },
      });
      expect(active.provider_subject).toBe('rejoin-sub');
      expect(active.deleted_at).toBeNull();

      // 탈퇴 계정의 email 은 되채워지지 않는다
      const stillWithdrawn = await prisma.account.findUniqueOrThrow({
        where: { id: withdrawn.id },
      });
      expect(stillWithdrawn.email).toBeNull();
    });

    it('subject 익명화 없이 soft-delete된 Identity가 남아 있으면 ConflictException', async () => {
      // MySQL unique index 는 deleted_at 을 보지 않는다. 익명화 없이 soft-delete 만 된
      // 잔여 row 가 있으면 신규 생성이 UNIQUE 에 걸리는데, Prisma 원문 에러(파일 경로·
      // 소스 라인 포함)가 500 본문으로 새어나가지 않도록 도메인 예외로 좁힌다.
      const account = await createAccount(prisma);
      const identity = await createAccountIdentity(prisma, {
        account_id: account.id,
        provider: 'GOOGLE',
        provider_subject: 'orphan-sub',
      });
      await prisma.accountIdentity.update({
        where: { id: identity.id },
        data: { deleted_at: new Date() },
      });

      await expect(
        repo.upsertUserByOidcIdentity({
          provider: IdentityProvider.GOOGLE,
          providerSubject: 'orphan-sub',
          providerEmail: 'orphan@example.com',
          emailVerified: true,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('기존 Identity + account email이 null + user_profile 없는 경우: profile 신규 생성 + email 주입', async () => {
      // account 는 있지만 email/profile 이 비어있는 초기 상태 재현
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
});
