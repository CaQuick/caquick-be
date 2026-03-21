import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AccountType } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserBaseService } from '@/features/user/services/user-base.service';

/** UserBaseService는 abstract이므로 테스트용 concrete 클래스를 만든다 */
class TestableUserBaseService extends UserBaseService {
  constructor(repo: UserRepository) {
    super(repo);
  }

  // protected 메서드를 public으로 노출
  public testRequireActiveUser(accountId: bigint) {
    return this.requireActiveUser(accountId);
  }

  public testNormalizeNickname(raw: string) {
    return this.normalizeNickname(raw);
  }

  public testNormalizeName(raw?: string | null) {
    return this.normalizeName(raw);
  }

  public testNormalizePhoneNumber(raw?: string | null) {
    return this.normalizePhoneNumber(raw);
  }

  public testNormalizeBirthDate(raw?: Date | string | null) {
    return this.normalizeBirthDate(raw);
  }

  public testNormalizePaginationInput(input?: {
    offset?: number | null;
    limit?: number | null;
    unreadOnly?: boolean | null;
  }) {
    return this.normalizePaginationInput(input);
  }
}

describe('UserBaseService', () => {
  let service: TestableUserBaseService;
  let repo: jest.Mocked<UserRepository>;

  beforeEach(() => {
    repo = {
      findAccountWithProfile: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;
    service = new TestableUserBaseService(repo);
  });

  describe('requireActiveUser', () => {
    it('활성 USER 계정이면 계정 정보를 반환해야 한다', async () => {
      const activeAccount = {
        id: BigInt(1),
        deleted_at: null,
        account_type: AccountType.USER,
        user_profile: {
          deleted_at: null,
          nickname: 'test',
        },
      };
      repo.findAccountWithProfile.mockResolvedValue(activeAccount as never);

      const result = await service.testRequireActiveUser(BigInt(1));
      expect(result.id).toBe(BigInt(1));
      expect(result.account_type).toBe(AccountType.USER);
    });

    it('계정이 없으면 UnauthorizedException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue(null);
      await expect(service.testRequireActiveUser(BigInt(1))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('삭제된 계정이면 UnauthorizedException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue({
        id: BigInt(1),
        deleted_at: new Date(),
        account_type: AccountType.USER,
        user_profile: { deleted_at: null },
      } as never);
      await expect(service.testRequireActiveUser(BigInt(1))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('USER 계정이 아니면 ForbiddenException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue({
        id: BigInt(1),
        deleted_at: null,
        account_type: AccountType.SELLER,
        user_profile: { deleted_at: null },
      } as never);
      await expect(service.testRequireActiveUser(BigInt(1))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('프로필이 없으면 UnauthorizedException을 던져야 한다', async () => {
      repo.findAccountWithProfile.mockResolvedValue({
        id: BigInt(1),
        deleted_at: null,
        account_type: AccountType.USER,
        user_profile: null,
      } as never);
      await expect(service.testRequireActiveUser(BigInt(1))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('normalizeNickname', () => {
    it('길이가 2 미만이면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testNormalizeNickname('a')).toThrow(
        BadRequestException,
      );
    });

    it('길이가 20 초과이면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testNormalizeNickname('a'.repeat(21))).toThrow(
        BadRequestException,
      );
    });

    it('허용되지 않는 문자가 포함되면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testNormalizeNickname('nick name!')).toThrow(
        BadRequestException,
      );
    });

    it('유효한 닉네임을 반환해야 한다', () => {
      expect(service.testNormalizeNickname('닉네임_test1')).toBe(
        '닉네임_test1',
      );
    });
  });

  describe('normalizePhoneNumber', () => {
    it('길이가 7 미만이면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testNormalizePhoneNumber('12345')).toThrow(
        BadRequestException,
      );
    });

    it('숫자와 하이픈 외 문자가 포함되면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testNormalizePhoneNumber('010-abc-1234')).toThrow(
        BadRequestException,
      );
    });

    it('null/undefined이면 null을 반환해야 한다', () => {
      expect(service.testNormalizePhoneNumber(null)).toBeNull();
      expect(service.testNormalizePhoneNumber(undefined)).toBeNull();
    });
  });

  describe('normalizeBirthDate', () => {
    it('유효하지 않은 날짜면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testNormalizeBirthDate('not-a-date')).toThrow(
        BadRequestException,
      );
    });

    it('미래 날짜면 BadRequestException을 던져야 한다', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      expect(() => service.testNormalizeBirthDate(futureDate)).toThrow(
        BadRequestException,
      );
    });

    it('null/undefined이면 null을 반환해야 한다', () => {
      expect(service.testNormalizeBirthDate(null)).toBeNull();
      expect(service.testNormalizeBirthDate(undefined)).toBeNull();
    });
  });

  describe('normalizePaginationInput', () => {
    it('offset이 음수이면 BadRequestException을 던져야 한다', () => {
      expect(() =>
        service.testNormalizePaginationInput({ offset: -1 }),
      ).toThrow(BadRequestException);
    });

    it('limit이 0 이하이면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testNormalizePaginationInput({ limit: 0 })).toThrow(
        BadRequestException,
      );
    });

    it('limit이 50 초과이면 BadRequestException을 던져야 한다', () => {
      expect(() => service.testNormalizePaginationInput({ limit: 51 })).toThrow(
        BadRequestException,
      );
    });

    it('기본값을 올바르게 설정해야 한다', () => {
      const result = service.testNormalizePaginationInput();
      expect(result).toEqual({ offset: 0, limit: 20, unreadOnly: false });
    });
  });
});
