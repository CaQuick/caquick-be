import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AccountType } from '@prisma/client';

import type { UserAccountWithProfile } from '../repositories/user.repository';
import { UserRepository } from '../repositories/user.repository';
import type { MePayload } from '../types/user-output.type';

export type ActiveUserAccount = UserAccountWithProfile & {
  deleted_at: null;
  user_profile: NonNullable<UserAccountWithProfile['user_profile']> & {
    deleted_at: null;
  };
};

export abstract class UserBaseService {
  protected constructor(protected readonly repo: UserRepository) {}

  protected async requireActiveUser(
    accountId: bigint,
  ): Promise<ActiveUserAccount> {
    const account = await this.repo.findAccountWithProfile(accountId, {
      withDeleted: true,
    });
    if (!account) throw new UnauthorizedException('Account not found.');
    if (account.deleted_at) {
      throw new UnauthorizedException('Account is deleted.');
    }
    if (account.account_type !== AccountType.USER) {
      throw new ForbiddenException('Only USER account is allowed.');
    }
    if (!account.user_profile || account.user_profile.deleted_at) {
      throw new UnauthorizedException('User profile not found.');
    }
    return account as ActiveUserAccount;
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
    };
  }

  protected normalizeNickname(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      throw new BadRequestException('Nickname length must be 2~20.');
    }
    const nicknameRegex = /^[A-Za-z0-9가-힣_]+$/;
    if (!nicknameRegex.test(trimmed)) {
      throw new BadRequestException('Nickname contains invalid characters.');
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
    if (trimmed.length < 7 || trimmed.length > 20) {
      throw new BadRequestException('Invalid phone number length.');
    }
    if (!/^[0-9-]+$/.test(trimmed)) {
      throw new BadRequestException('Invalid phone number format.');
    }
    return trimmed;
  }

  protected normalizeBirthDate(raw?: Date | string | null): Date | null {
    if (raw === undefined || raw === null) return null;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid birthDate.');
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    if (normalized > today) {
      throw new BadRequestException('birthDate cannot be in the future.');
    }
    return normalized;
  }

  protected normalizePaginationInput(input?: {
    offset?: number | null;
    limit?: number | null;
    unreadOnly?: boolean | null;
  }): { offset: number; limit: number; unreadOnly: boolean } {
    const offset = Number.isFinite(input?.offset) ? Number(input?.offset) : 0;
    const limit = Number.isFinite(input?.limit) ? Number(input?.limit) : 20;
    const unreadOnly = Boolean(input?.unreadOnly);

    if (offset < 0) {
      throw new BadRequestException('Offset must be >= 0.');
    }
    if (limit <= 0 || limit > 50) {
      throw new BadRequestException('Limit must be between 1 and 50.');
    }

    return { offset, limit, unreadOnly };
  }
}
