import type { IAuditLogRepository } from '@/features/audit-log';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { SellerBaseService } from '@/features/store/services/store-seller-base.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

class TestableSellerBaseService extends SellerBaseService {
  constructor(repo: StoreSellerRepository, auditLogs: IAuditLogRepository) {
    super(repo, auditLogs);
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
      providers: [StoreSellerRepository],
    });
    const repo = module.get(StoreSellerRepository);
    const auditLogs: IAuditLogRepository = {
      createAuditLog: jest.fn(),
      countAuditLogsBySeller: jest.fn(),
      listAuditLogsBySeller: jest.fn(),
      countAuditLogs: jest.fn(),
      listAuditLogs: jest.fn(),
    };
    service = new TestableSellerBaseService(repo, auditLogs);
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
    it('계정이 존재하지 않으면 401', async () => {
      await expect(
        service.testRequireSellerContext(BigInt(99999)),
      ).rejects.toThrowDomain(401);
    });

    it('SELLER가 아닌 계정이면 403', async () => {
      const userAccount = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.testRequireSellerContext(userAccount.id),
      ).rejects.toThrowDomain(403);
    });

    it('SELLER인데 store가 없으면 404', async () => {
      const account = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(
        service.testRequireSellerContext(account.id),
      ).rejects.toThrowDomain(404);
    });

    it('SELLER + store 조합이면 SellerContext를 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const ctx = await service.testRequireSellerContext(account.id);
      expect(ctx.accountId).toBe(account.id);
      expect(ctx.storeId).toBe(store.id);
    });
  });

  describe('parseIdList', () => {
    it('중복된 ID면 400', () => {
      expect(() => service.testParseIdList(['1', '2', '1'])).toThrowDomain(400);
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

    it('잘못된 문자열이면 400', () => {
      expect(() => service.testToTime('not-a-date')).toThrowDomain(400);
    });

    it('Date 객체면 그대로 통과한다', () => {
      const d = new Date('2026-04-01T12:00:00Z');
      expect(service.testToTime(d)).toEqual(d);
    });
  });

  describe('toDecimal', () => {
    it('잘못된 형식이면 400', () => {
      expect(() => service.testToDecimal('not-a-number')).toThrowDomain(400);
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
    it('잘못된 통화 형식이면 400', () => {
      expect(() => service.testCleanCurrency('ABCD')).toThrowDomain(400);
    });

    it('null이면 KRW 기본값', () => {
      expect(service.testCleanCurrency(null)).toBe('KRW');
    });

    it('대소문자 혼합 입력은 대문자로 정규화', () => {
      expect(service.testCleanCurrency(' usd ')).toBe('USD');
    });
  });

  describe('assertPositiveRange', () => {
    it('범위 미만이면 400', () => {
      expect(() =>
        service.testAssertPositiveRange(0, 1, 100, 'x'),
      ).toThrowDomain(400);
    });

    it('범위 초과면 400', () => {
      expect(() =>
        service.testAssertPositiveRange(101, 1, 100, 'x'),
      ).toThrowDomain(400);
    });

    it('정수가 아니면 400', () => {
      expect(() =>
        service.testAssertPositiveRange(1.5, 1, 100, 'x'),
      ).toThrowDomain(400);
    });

    it('범위 내 정수면 통과', () => {
      expect(() =>
        service.testAssertPositiveRange(50, 1, 100, 'x'),
      ).not.toThrow();
    });
  });
});
