import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { SellerRepository } from '../repositories/seller.repository';

import { SellerBaseService } from './seller-base.service';

/** SellerBaseService는 abstract이므로 테스트용 concrete 클래스를 만든다 */
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

describe('SellerBaseService', () => {
  let service: TestableSellerBaseService;
  let repo: jest.Mocked<SellerRepository>;

  beforeEach(() => {
    repo = {
      findSellerAccountContext: jest.fn(),
    } as unknown as jest.Mocked<SellerRepository>;
    service = new TestableSellerBaseService(repo);
  });

  describe('requireSellerContext', () => {
    it('계정이 없으면 UnauthorizedException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue(null);
      await expect(service.testRequireSellerContext(BigInt(1))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('SELLER 계정이 아니면 ForbiddenException을 던져야 한다', async () => {
      repo.findSellerAccountContext.mockResolvedValue({
        id: BigInt(1),
        account_type: 'USER',
        status: 'ACTIVE',
        store: { id: BigInt(100) },
      } as never);
      await expect(service.testRequireSellerContext(BigInt(1))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('parseIdList', () => {
    it('중복된 ID가 있으면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testParseIdList(['1', '2', '1'])).toThrow(
        BadRequestException,
      );
    });

    it('유효한 ID 목록을 파싱해야 한다', () => {
      const result = service.testParseIdList(['1', '2', '3']);
      expect(result).toEqual([BigInt(1), BigInt(2), BigInt(3)]);
    });
  });

  describe('toDecimal', () => {
    it('유효하지 않은 값이면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testToDecimal('not-a-number')).toThrow(
        BadRequestException,
      );
    });

    it('null/undefined이면 null을 반환해야 한다', () => {
      expect(service.testToDecimal(null)).toBeNull();
      expect(service.testToDecimal(undefined)).toBeNull();
    });

    it('빈 문자열이면 null을 반환해야 한다', () => {
      expect(service.testToDecimal('')).toBeNull();
      expect(service.testToDecimal('  ')).toBeNull();
    });
  });

  describe('cleanCurrency', () => {
    it('유효하지 않은 통화 형식이면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testCleanCurrency('ABCD')).toThrow(
        BadRequestException,
      );
    });

    it('null이면 기본값 KRW를 반환해야 한다', () => {
      expect(service.testCleanCurrency(null)).toBe('KRW');
    });
  });

  describe('assertPositiveRange', () => {
    it('범위 밖이면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testAssertPositiveRange(0, 1, 100, 'field')).toThrow(
        BadRequestException,
      );

      expect(() =>
        service.testAssertPositiveRange(101, 1, 100, 'field'),
      ).toThrow(BadRequestException);
    });

    it('정수가 아니면 BadRequestException을 던져야 한다', () => {
      expect(() =>
        service.testAssertPositiveRange(1.5, 1, 100, 'field'),
      ).toThrow(BadRequestException);
    });

    it('범위 내 정수면 예외를 던지지 않아야 한다', () => {
      expect(() =>
        service.testAssertPositiveRange(50, 1, 100, 'field'),
      ).not.toThrow();
    });
  });
});
