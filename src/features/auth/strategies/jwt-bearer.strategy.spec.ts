import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { AccountRepository } from '@/features/auth/repositories/account.repository';
import { ACCOUNT_REPOSITORY } from '@/features/auth/repositories/account.repository.interface';
import { JwtBearerStrategy } from '@/features/auth/strategies/jwt-bearer.strategy';
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
          iat: 0,
          exp: 0,
        });

        expect(result.accountType).toBe('ADMIN');
        expect(result.mustChangePassword).toBe(mustChange);
      },
    );

    it('sub가 없으면 UnauthorizedException을 던진다', async () => {
      await expect(
        strategy.validate({
          sub: '',
          typ: 'access',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('typ이 access가 아니면 UnauthorizedException을 던진다', async () => {
      await expect(
        strategy.validate({
          sub: '1',
          typ: 'refresh' as 'access',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('존재하지 않는 계정이면 UnauthorizedException을 던진다', async () => {
      await expect(
        strategy.validate({
          sub: '99999',
          typ: 'access',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('ACTIVE가 아닌 계정이면 ForbiddenException을 던진다', async () => {
      const account = await createAccount(prisma, {
        account_type: 'USER',
        status: 'SUSPENDED',
      });

      await expect(
        strategy.validate({
          sub: account.id.toString(),
          typ: 'access',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('유효하지 않은 sub 형식이면 UnauthorizedException을 던진다', async () => {
      await expect(
        strategy.validate({
          sub: 'not-a-number',
          typ: 'access',
          iat: 0,
          exp: 0,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('constructor 분기', () => {
    /**
     * 생성자에서 시크릿 필수 검증을 fail-fast 한다.
     * 시크릿은 raw 환경변수가 아니라 authConfig 해석값(auth.jwtSecret)에서 온다 —
     * JWT_SECRET만 설정한 배포가 config 검증만 통과하고 여기서 죽던 회귀의 수정점.
     * (해석 규칙은 config/auth.config.spec.ts, 소비 규칙은
     *  global/auth/access-token-secret.spec.ts에서 전수로 고정한다.)
     */
    it.each([
      { label: '미설정', value: undefined },
      { label: '빈 문자열', value: '' },
      { label: '공백 문자열', value: '   ' },
    ])('시크릿이 $label 이면 Error', ({ value }) => {
      const config = { get: () => value } as never;
      const accounts = {} as never;
      expect(() => new JwtBearerStrategy(config, accounts)).toThrow(
        'Missing JWT access token secret',
      );
    });

    it('해석된 시크릿이 있으면 생성된다', () => {
      const config = { get: () => 'resolved-secret' } as never;
      const accounts = {} as never;
      expect(() => new JwtBearerStrategy(config, accounts)).not.toThrow();
    });
  });
});
