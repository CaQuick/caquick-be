import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { AuthRepository } from '@/features/auth/repositories/auth.repository';
import { JwtBearerStrategy } from '@/features/auth/strategies/jwt-bearer.strategy';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('JwtBearerStrategy (real DB)', () => {
  let strategy: JwtBearerStrategy;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AuthRepository,
        ClockService,
        {
          provide: JwtBearerStrategy,
          useFactory: (repo: AuthRepository) => {
            // Passport Strategy는 생성자에서 super()를 호출하므로 직접 생성
            // validate 메서드만 테스트하기 위해 prototype에서 추출
            const instance = Object.create(JwtBearerStrategy.prototype);
            instance.repo = repo;
            return instance;
          },
          inject: [AuthRepository],
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
    });

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
     * 생성자에서 JWT_ACCESS_SECRET 필수 검증을 fail-fast 한다.
     * - 미설정/공백만 있는 경우 모두 throw 되어야 한다.
     * - passport-jwt Strategy 생성자는 secret 없을 때 내부적으로 throw하므로,
     *   config에 빈 문자열이면 커스텀 throw가 먼저 발생함을 확인한다.
     */
    it('JWT_ACCESS_SECRET 미설정이면 Error', () => {
      const config = { get: () => undefined } as never;
      const repo = {} as never;
      expect(() => new JwtBearerStrategy(config, repo)).toThrow(
        'Missing JWT_ACCESS_SECRET',
      );
    });

    it('JWT_ACCESS_SECRET이 공백 문자열이면 Error', () => {
      const config = { get: () => '   ' } as never;
      const repo = {} as never;
      expect(() => new JwtBearerStrategy(config, repo)).toThrow(
        'Missing JWT_ACCESS_SECRET',
      );
    });
  });
});
