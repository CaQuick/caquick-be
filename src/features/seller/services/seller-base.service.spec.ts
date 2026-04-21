import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

class TestableSellerBaseService extends SellerBaseService {
  constructor(repo: SellerRepository) {
    super(repo);
  }

  public testRequireSellerContext(accountId: bigint) {
    return this.requireSellerContext(accountId);
  }

  public testParseIdList(rawIds: string[]) {
    return this.parseIdList(rawIds);
  }

  public testToTime(raw?: Date | string | null) {
    return this.toTime(raw);
  }

  public testToDecimal(raw?: string | null) {
    return this.toDecimal(raw);
  }

  public testCleanCurrency(raw?: string | null) {
    return this.cleanCurrency(raw);
  }

  public testAssertPositiveRange(
    value: number,
    min: number,
    max: number,
    field: string,
  ) {
    return this.assertPositiveRange(value, min, max, field);
  }
}

describe('SellerBaseService (real DB)', () => {
  let service: TestableSellerBaseService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SellerRepository],
    });
    const repo = module.get(SellerRepository);
    service = new TestableSellerBaseService(repo);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('requireSellerContext', () => {
    it('계정이 존재하지 않으면 UnauthorizedException', async () => {
      await expect(
        service.testRequireSellerContext(BigInt(99999)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('SELLER가 아닌 계정이면 ForbiddenException', async () => {
      const userAccount = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.testRequireSellerContext(userAccount.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('SELLER인데 store가 없으면 NotFoundException', async () => {
      const account = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(
        service.testRequireSellerContext(account.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('SELLER + store 조합이면 SellerContext를 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const ctx = await service.testRequireSellerContext(account.id);
      expect(ctx.accountId).toBe(account.id);
      expect(ctx.storeId).toBe(store.id);
    });
  });

  describe('parseIdList', () => {
    it('중복된 ID면 BadRequestException', () => {
      expect(() => service.testParseIdList(['1', '2', '1'])).toThrow(
        BadRequestException,
      );
    });

    it('유효한 ID 목록을 BigInt 배열로 파싱한다', () => {
      expect(service.testParseIdList(['1', '2', '3'])).toEqual([
        BigInt(1),
        BigInt(2),
        BigInt(3),
      ]);
    });
  });

  describe('toTime', () => {
    it('null/undefined면 null', () => {
      expect(service.testToTime(null)).toBeNull();
      expect(service.testToTime(undefined)).toBeNull();
    });

    it('잘못된 문자열이면 BadRequestException', () => {
      expect(() => service.testToTime('not-a-date')).toThrow(
        BadRequestException,
      );
    });

    it('Date 객체면 그대로 통과한다', () => {
      const d = new Date('2026-04-01T12:00:00Z');
      expect(service.testToTime(d)).toEqual(d);
    });
  });

  describe('toDecimal', () => {
    it('잘못된 형식이면 BadRequestException', () => {
      expect(() => service.testToDecimal('not-a-number')).toThrow(
        BadRequestException,
      );
    });

    it('null/undefined/공백 문자열은 null', () => {
      expect(service.testToDecimal(null)).toBeNull();
      expect(service.testToDecimal(undefined)).toBeNull();
      expect(service.testToDecimal('')).toBeNull();
      expect(service.testToDecimal('  ')).toBeNull();
    });

    it('정상 숫자 문자열은 Prisma.Decimal로 변환한다', () => {
      const result = service.testToDecimal('123.45');
      expect(result?.toString()).toBe('123.45');
    });
  });

  describe('cleanCurrency', () => {
    it('잘못된 통화 형식이면 BadRequestException', () => {
      expect(() => service.testCleanCurrency('ABCD')).toThrow(
        BadRequestException,
      );
    });

    it('null이면 KRW 기본값', () => {
      expect(service.testCleanCurrency(null)).toBe('KRW');
    });

    it('대소문자 혼합 입력은 대문자로 정규화', () => {
      expect(service.testCleanCurrency(' usd ')).toBe('USD');
    });
  });

  describe('assertPositiveRange', () => {
    it('범위 미만이면 BadRequestException', () => {
      expect(() => service.testAssertPositiveRange(0, 1, 100, 'x')).toThrow(
        BadRequestException,
      );
    });

    it('범위 초과면 BadRequestException', () => {
      expect(() => service.testAssertPositiveRange(101, 1, 100, 'x')).toThrow(
        BadRequestException,
      );
    });

    it('정수가 아니면 BadRequestException', () => {
      expect(() => service.testAssertPositiveRange(1.5, 1, 100, 'x')).toThrow(
        BadRequestException,
      );
    });

    it('범위 내 정수면 통과', () => {
      expect(() =>
        service.testAssertPositiveRange(50, 1, 100, 'x'),
      ).not.toThrow();
    });
  });
});
