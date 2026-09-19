import { DomainException } from '@/common/errors/error-catalog';
import { utcDateOnly } from '@/common/utils/date-parser';
import {
  DEFAULT_PAGINATION_LIMIT,
  MAX_NICKNAME_LENGTH,
  MAX_PAGINATION_LIMIT,
  MIN_BIRTH_DATE,
  MIN_NICKNAME_LENGTH,
  PHONE_FORMAT_EXAMPLE,
  PHONE_REGEX,
} from '@/features/auth/constants/auth-user.constants';
import {
  AccountUserRepository,
  type UserAccountWithProfile,
} from '@/features/auth/repositories/account-user.repository';
import { evaluateActiveUserAccount } from '@/features/auth/services/auth-user-account-policy.helper';
import type { MePayload } from '@/features/auth/types/auth-user-output.type';
export type ActiveUserAccount = UserAccountWithProfile & {
  deleted_at: null;
  user_profile: NonNullable<UserAccountWithProfile['user_profile']> & {
    deleted_at: null;
  };
};

export abstract class UserBaseService {
  protected constructor(protected readonly accounts: AccountUserRepository) {}

  protected async requireActiveUser(
    accountId: bigint,
  ): Promise<ActiveUserAccount> {
    const account = await this.accounts.findAccountWithProfile(accountId, {
      withDeleted: true,
    });
    // 판정 분기는 공용 정책(user-account-policy.helper) 단일 소스 — 메시지 매핑만 여기서
    switch (evaluateActiveUserAccount(account)) {
      case 'ACCOUNT_NOT_FOUND':
        throw new DomainException('SESSION_ACCOUNT_MISSING');
      case 'ACCOUNT_DELETED':
        throw new DomainException('ACCOUNT_DELETED');
      case 'NOT_USER':
        throw new DomainException('USER_ONLY');
      case 'PROFILE_INACTIVE':
        throw new DomainException('PROFILE_NOT_FOUND');
      case null:
        return account as ActiveUserAccount;
    }
  }

  protected toMePayload(account: ActiveUserAccount): MePayload {
    return {
      accountId: account.id.toString(),
      email: account.email,
      name: account.name,
      accountType: account.account_type,
      profile: {
        nickname: account.user_profile.nickname,
        birthDate: account.user_profile.birth_date,
        phoneNumber: account.user_profile.phone_number,
        profileImageUrl: account.user_profile.profile_image_url,
        onboardingCompletedAt: account.user_profile.onboarding_completed_at,
      },
      linkedIdentities: account.account_identities.map((identity) => ({
        provider: identity.provider,
        lastLoginAt: identity.last_login_at,
      })),
    };
  }

  protected normalizeNickname(raw: string): string {
    const trimmed = raw.trim();
    if (
      trimmed.length < MIN_NICKNAME_LENGTH ||
      trimmed.length > MAX_NICKNAME_LENGTH
    ) {
      throw new DomainException('NICKNAME_LENGTH_INVALID', {
        min: MIN_NICKNAME_LENGTH,
        max: MAX_NICKNAME_LENGTH,
      });
    }
    const nicknameRegex = /^[A-Za-z0-9가-힣_]+$/;
    if (!nicknameRegex.test(trimmed)) {
      throw new DomainException('NICKNAME_INVALID_CHARACTERS');
    }
    return trimmed;
  }

  protected normalizeName(raw?: string | null): string | null {
    if (raw === undefined || raw === null) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  protected normalizePhoneNumber(raw?: string | null): string | null {
    if (raw === undefined || raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    if (!PHONE_REGEX.test(trimmed)) {
      throw new DomainException('INVALID_PHONE_FORMAT', {
        example: PHONE_FORMAT_EXAMPLE,
      });
    }
    return trimmed;
  }

  protected normalizeBirthDate(raw?: Date | string | null): Date | null {
    if (raw === undefined || raw === null) return null;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new DomainException('INVALID_BIRTH_DATE');
    }
    // DB가 @db.Date(시간 무시) + GraphQL DateTime이 ISO string을 UTC로 해석하므로
    // timezone 독립적으로 UTC 자정 기준으로 정규화한다.
    const normalized = utcDateOnly(date);
    if (normalized < MIN_BIRTH_DATE) {
      throw new DomainException('BIRTH_DATE_TOO_OLD');
    }
    const todayUtc = utcDateOnly(new Date());
    if (normalized > todayUtc) {
      throw new DomainException('BIRTH_DATE_IN_FUTURE');
    }
    return normalized;
  }

  protected normalizePaginationInput(input?: {
    offset?: number | null;
    limit?: number | null;
    unreadOnly?: boolean | null;
  }): { offset: number; limit: number; unreadOnly: boolean } {
    const offset = Number.isFinite(input?.offset) ? Number(input?.offset) : 0;
    const limit = Number.isFinite(input?.limit)
      ? Number(input?.limit)
      : DEFAULT_PAGINATION_LIMIT;
    const unreadOnly = Boolean(input?.unreadOnly);

    if (offset < 0) {
      throw new DomainException('INVALID_OFFSET');
    }
    if (limit <= 0 || limit > MAX_PAGINATION_LIMIT) {
      throw new DomainException('INVALID_LIMIT', { max: MAX_PAGINATION_LIMIT });
    }

    return { offset, limit, unreadOnly };
  }
}
