import { ClockService } from '@/common/providers/clock.service';
import { AccountRepository } from '@/features/auth/repositories/account.repository';
import { ACCOUNT_REPOSITORY } from '@/features/auth/repositories/account.repository.interface';
import { JwtBearerStrategy } from '@/features/auth/strategies/jwt-bearer.strategy';
import type { PrismaClient } from '@/generated/prisma/client';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createAccountCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('JwtBearerStrategy (real DB)', () => {
  let strategy: JwtBearerStrategy;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ClockService,
        {
          provide: ACCOUNT_REPOSITORY,
          useClass: AccountRepository,
        },
        {
          provide: JwtBearerStrategy,
          useFactory: (accounts: AccountRepository) => {
            // Passport Strategy 는 생성자에서 super() 를 호출하므로 직접 생성.
            // validate 메서드만 테스트하기 위해 prototype 에서 추출.
            const instance = Object.create(JwtBearerStrategy.prototype);
            instance.accounts = accounts;
            return instance;
          },
          inject: [ACCOUNT_REPOSITORY],
        },
      ],
    });
    strategy = module.get(JwtBearerStrategy);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('validate', () => {
    it('유효한 payload이면 JwtUser를 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });

      const result = await strategy.validate({
        sub: account.id.toString(),
        typ: 'access',
        role: 'USER',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      expect(result.accountId).toBe(account.id.toString());
      expect(result.accountType).toBe('USER');
      // 자격증명이 없는 USER는 변경 강제 상태가 아니다
      expect(result.mustChangePassword).toBe(false);
    });

    it.each([true, false])(
      '자격증명 계정은 must_change_password(%s)를 JwtUser에 싣는다',
      async (mustChange) => {
        const credential = await createAccountCredential(prisma, {
          account_type: 'ADMIN',
          must_change_password: mustChange,
        });

        const result = await strategy.validate({
          sub: credential.account_id.toString(),
          typ: 'access',
          role: 'USER',
          iat: 0,
          exp: 0,
        });

        expect(result.accountType).toBe('ADMIN');
        expect(result.mustChangePassword).toBe(mustChange);
      },
    );

    it('sub가 없으면 INVALID_ACCESS_TOKEN', async () => {
      await expect(
        strategy.validate({
          sub: '',
          typ: 'access',
          role: 'USER',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrowDomain('INVALID_ACCESS_TOKEN');
    });

    it('typ이 access가 아니면 INVALID_ACCESS_TOKEN', async () => {
      await expect(
        strategy.validate({
          sub: '1',
          typ: 'refresh' as 'access',
          role: 'USER',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrowDomain('INVALID_ACCESS_TOKEN');
    });

    it('존재하지 않는 계정이면 SESSION_ACCOUNT_MISSING', async () => {
      await expect(
        strategy.validate({
          sub: '99999',
          typ: 'access',
          role: 'USER',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrowDomain('SESSION_ACCOUNT_MISSING');
    });

    it('ACTIVE가 아닌 계정이면 ACCOUNT_NOT_ACTIVE', async () => {
      const account = await createAccount(prisma, {
        account_type: 'USER',
        status: 'SUSPENDED',
      });

      await expect(
        strategy.validate({
          sub: account.id.toString(),
          typ: 'access',
          role: 'USER',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrowDomain('ACCOUNT_NOT_ACTIVE');
    });

    it('유효하지 않은 sub 형식이면 INVALID_ACCESS_TOKEN', async () => {
      await expect(
        strategy.validate({
          sub: 'not-a-number',
          typ: 'access',
          role: 'USER',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrowDomain('INVALID_ACCESS_TOKEN');
    });
  });

  describe('constructor', () => {
    // 시크릿 검증(폴백·공백·prod)은 auth.config.spec이 담당한다. 여기서는 해석값을 그대로 쓰는지만 본다.
    it('authConfig의 공개키·iss·aud로 생성된다', () => {
      const getOrThrow = jest.fn().mockReturnValue(TEST_AUTH_CONFIG);
      const config = { getOrThrow } as never;
      const accounts = {} as never;

      expect(() => new JwtBearerStrategy(config, accounts)).not.toThrow();
      expect(getOrThrow).toHaveBeenCalledWith('auth');
    });
  });
});
