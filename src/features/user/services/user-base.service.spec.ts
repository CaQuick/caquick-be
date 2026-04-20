import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserBaseService } from '@/features/user/services/user-base.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createUserProfile } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/** UserBaseService는 abstract이므로 테스트용 concrete 클래스를 만든다 */
class TestableUserBaseService extends UserBaseService {
  constructor(repo: UserRepository) {
    super(repo);
  }

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

describe('UserBaseService (real DB)', () => {
  let service: TestableUserBaseService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [UserRepository],
    });
    const repo = module.get(UserRepository);
    service = new TestableUserBaseService(repo);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─────────────────────────────────────────────
  // requireActiveUser — DB 상태 의존
  // ─────────────────────────────────────────────
  describe('requireActiveUser', () => {
    it('활성 USER 계정이면 계정 + 프로필 정보를 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });

      const result = await service.testRequireActiveUser(account.id);

      expect(result.id).toBe(account.id);
      expect(result.account_type).toBe('USER');
      expect(result.user_profile).not.toBeNull();
    });

    it('계정이 존재하지 않으면 UnauthorizedException을 던진다', async () => {
      await expect(
        service.testRequireActiveUser(BigInt(999999)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('soft delete 된 계정이면 UnauthorizedException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, { account_id: account.id });
      await prisma.account.update({
        where: { id: account.id },
        data: { deleted_at: new Date() },
      });

      await expect(service.testRequireActiveUser(account.id)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('USER 이외 타입(SELLER)이면 ForbiddenException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'SELLER' });

      await expect(service.testRequireActiveUser(account.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('프로필이 없는 USER 계정이면 UnauthorizedException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });

      await expect(service.testRequireActiveUser(account.id)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('프로필이 soft delete 된 경우 UnauthorizedException을 던진다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const profile = await createUserProfile(prisma, {
        account_id: account.id,
      });
      await prisma.userProfile.update({
        where: { id: profile.id },
        data: { deleted_at: new Date() },
      });

      await expect(service.testRequireActiveUser(account.id)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─────────────────────────────────────────────
  // 순수 함수 — DB 의존 없음
  // ─────────────────────────────────────────────
  describe('normalizeNickname', () => {
    it('길이가 하한 미만이면 BadRequestException을 던진다', () => {
      expect(() => service.testNormalizeNickname('a')).toThrow(
        BadRequestException,
      );
    });

    it('길이가 상한 초과이면 BadRequestException을 던진다', () => {
      expect(() => service.testNormalizeNickname('a'.repeat(21))).toThrow(
        BadRequestException,
      );
    });

    it('허용되지 않는 특수문자가 포함되면 BadRequestException을 던진다', () => {
      expect(() => service.testNormalizeNickname('nick name!')).toThrow(
        BadRequestException,
      );
    });

    it('앞뒤 공백을 제거하고 유효한 닉네임을 반환한다', () => {
      expect(service.testNormalizeNickname('  닉네임_test1  ')).toBe(
        '닉네임_test1',
      );
    });
  });

  describe('normalizeName', () => {
    it('null/undefined/공백-only이면 null을 반환한다', () => {
      expect(service.testNormalizeName(null)).toBeNull();
      expect(service.testNormalizeName(undefined)).toBeNull();
      expect(service.testNormalizeName('   ')).toBeNull();
    });

    it('앞뒤 공백을 제거한 이름을 반환한다', () => {
      expect(service.testNormalizeName('  홍길동  ')).toBe('홍길동');
    });
  });

  describe('normalizePhoneNumber', () => {
    it('null/undefined/공백-only이면 null을 반환한다', () => {
      expect(service.testNormalizePhoneNumber(null)).toBeNull();
      expect(service.testNormalizePhoneNumber(undefined)).toBeNull();
      expect(service.testNormalizePhoneNumber('   ')).toBeNull();
    });

    it('길이가 하한 미만이면 BadRequestException을 던진다', () => {
      expect(() => service.testNormalizePhoneNumber('12345')).toThrow(
        BadRequestException,
      );
    });

    it('숫자와 하이픈 외 문자가 포함되면 BadRequestException을 던진다', () => {
      expect(() => service.testNormalizePhoneNumber('010-abc-1234')).toThrow(
        BadRequestException,
      );
    });

    it('유효한 전화번호를 반환한다', () => {
      expect(service.testNormalizePhoneNumber('010-1234-5678')).toBe(
        '010-1234-5678',
      );
    });
  });

  describe('normalizeBirthDate', () => {
    it('null/undefined이면 null을 반환한다', () => {
      expect(service.testNormalizeBirthDate(null)).toBeNull();
      expect(service.testNormalizeBirthDate(undefined)).toBeNull();
    });

    it('유효하지 않은 날짜 문자열이면 BadRequestException을 던진다', () => {
      expect(() => service.testNormalizeBirthDate('not-a-date')).toThrow(
        BadRequestException,
      );
    });

    it('미래 날짜면 BadRequestException을 던진다', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      expect(() => service.testNormalizeBirthDate(future)).toThrow(
        BadRequestException,
      );
    });

    it('문자열 날짜를 Date 객체로 변환한다', () => {
      const result = service.testNormalizeBirthDate('1990-05-15');
      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(1990);
    });

    it('오늘 날짜는 미래로 취급하지 않고 그대로 반환한다', () => {
      const today = new Date();
      today.setHours(12, 0, 0, 0);

      const result = service.testNormalizeBirthDate(today);

      expect(result).toBeInstanceOf(Date);
      // 시간은 00:00:00으로 내부 정규화되지만 날짜 자체는 오늘과 같아야 함
      expect(result?.toDateString()).toBe(today.toDateString());
    });
  });

  describe('normalizePaginationInput', () => {
    it('offset 음수면 BadRequestException을 던진다', () => {
      expect(() =>
        service.testNormalizePaginationInput({ offset: -1 }),
      ).toThrow(BadRequestException);
    });

    it('limit이 0 이하면 BadRequestException을 던진다', () => {
      expect(() => service.testNormalizePaginationInput({ limit: 0 })).toThrow(
        BadRequestException,
      );
    });

    it('limit이 상한(50) 초과면 BadRequestException을 던진다', () => {
      expect(() => service.testNormalizePaginationInput({ limit: 51 })).toThrow(
        BadRequestException,
      );
    });

    it('입력이 없으면 기본값을 반환한다', () => {
      expect(service.testNormalizePaginationInput()).toEqual({
        offset: 0,
        limit: 20,
        unreadOnly: false,
      });
    });

    it('unreadOnly 값을 boolean으로 강제 변환한다', () => {
      expect(
        service.testNormalizePaginationInput({
          offset: 0,
          limit: 10,
          unreadOnly: null,
        }).unreadOnly,
      ).toBe(false);
    });
  });
});
