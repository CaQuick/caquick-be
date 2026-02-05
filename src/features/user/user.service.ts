import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AccountType } from '@prisma/client';

import type { UserAccountWithProfile } from './repositories/user.repository';
import { UserRepository } from './repositories/user.repository';
import type {
  CompleteOnboardingInput,
  MyNotificationsInput,
  MySearchHistoriesInput,
  UpdateMyProfileImageInput,
  UpdateMyProfileInput,
} from './types/user-input.type';
import type {
  MePayload,
  NotificationConnection,
  SearchHistoryConnection,
  ViewerCounts,
} from './types/user-output.type';

/**
 * 일반 유저 기능 서비스
 */
@Injectable()
export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async me(accountId: bigint): Promise<MePayload> {
    const account = await this.requireActiveUser(accountId);
    return this.toMePayload(account);
  }

  async viewerCounts(accountId: bigint): Promise<ViewerCounts> {
    await this.requireActiveUser(accountId);
    return this.repo.getViewerCounts(accountId);
  }

  async myNotifications(
    accountId: bigint,
    input?: MyNotificationsInput,
  ): Promise<NotificationConnection> {
    await this.requireActiveUser(accountId);

    const { offset, limit, unreadOnly } = this.normalizePaginationInput(input);
    const result = await this.repo.listNotifications({
      accountId,
      unreadOnly,
      offset,
      limit,
    });

    return {
      items: result.items.map((item) => ({
        id: item.id.toString(),
        type: item.type,
        title: item.title,
        body: item.body,
        readAt: item.read_at,
        createdAt: item.created_at,
      })),
      totalCount: result.totalCount,
      hasMore: offset + limit < result.totalCount,
    };
  }

  async mySearchHistories(
    accountId: bigint,
    input?: MySearchHistoriesInput,
  ): Promise<SearchHistoryConnection> {
    await this.requireActiveUser(accountId);

    const { offset, limit } = this.normalizePaginationInput(input);
    const result = await this.repo.listSearchHistories({
      accountId,
      offset,
      limit,
    });

    return {
      items: result.items.map((item) => ({
        id: item.id.toString(),
        keyword: item.keyword,
        lastUsedAt: item.last_used_at,
      })),
      totalCount: result.totalCount,
      hasMore: offset + limit < result.totalCount,
    };
  }

  async completeOnboarding(
    accountId: bigint,
    input: CompleteOnboardingInput,
  ): Promise<MePayload> {
    const account = await this.requireActiveUser(accountId);

    const nickname = this.normalizeNickname(input.nickname);
    const phoneNumber = this.normalizePhoneNumber(input.phoneNumber);
    const birthDate = this.normalizeBirthDate(input.birthDate);
    const name = this.normalizeName(input.name);

    if (!account.name && !name) {
      throw new BadRequestException('Name is required.');
    }

    const isTaken = await this.repo.isNicknameTaken(nickname, accountId);
    if (isTaken) throw new ConflictException('Nickname already exists.');

    await this.repo.completeOnboarding({
      accountId,
      name: account.name ? null : name,
      nickname,
      birthDate,
      phoneNumber,
      now: new Date(),
    });

    return this.me(accountId);
  }

  async updateMyProfile(
    accountId: bigint,
    input: UpdateMyProfileInput,
  ): Promise<MePayload> {
    await this.requireActiveUser(accountId);

    const hasNickname = input.nickname !== undefined;
    const hasBirthDate = input.birthDate !== undefined;
    const hasPhoneNumber = input.phoneNumber !== undefined;

    if (!hasNickname && !hasBirthDate && !hasPhoneNumber) {
      throw new BadRequestException('No fields to update.');
    }

    const nickname = hasNickname
      ? this.normalizeNickname(input.nickname ?? '')
      : undefined;

    if (nickname) {
      const isTaken = await this.repo.isNicknameTaken(nickname, accountId);
      if (isTaken) throw new ConflictException('Nickname already exists.');
    }

    const birthDate = hasBirthDate
      ? this.normalizeBirthDate(input.birthDate)
      : undefined;
    const phoneNumber = hasPhoneNumber
      ? this.normalizePhoneNumber(input.phoneNumber)
      : undefined;

    await this.repo.updateProfile({
      accountId,
      ...(hasNickname ? { nickname } : {}),
      ...(hasBirthDate ? { birthDate } : {}),
      ...(hasPhoneNumber ? { phoneNumber } : {}),
    });

    return this.me(accountId);
  }

  async updateMyProfileImage(
    accountId: bigint,
    input: UpdateMyProfileImageInput,
  ): Promise<MePayload> {
    await this.requireActiveUser(accountId);

    const profileImageUrl = input.profileImageUrl.trim();
    if (profileImageUrl.length === 0) {
      throw new BadRequestException('profileImageUrl is required.');
    }
    if (profileImageUrl.length > 2048) {
      throw new BadRequestException('profileImageUrl is too long.');
    }

    await this.repo.updateProfileImage({
      accountId,
      profileImageUrl,
    });

    return this.me(accountId);
  }

  async deleteMyAccount(accountId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const now = new Date();
    const deletedNickname = `deleted_${accountId.toString()}`;

    await this.repo.softDeleteAccount({
      accountId,
      deletedNickname,
      now,
    });

    return true;
  }

  async markNotificationRead(
    accountId: bigint,
    notificationId: bigint,
  ): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const updated = await this.repo.markNotificationRead({
      accountId,
      notificationId,
      now: new Date(),
    });

    if (!updated) {
      throw new NotFoundException('Notification not found.');
    }

    return true;
  }

  async markAllNotificationsRead(accountId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);
    await this.repo.markAllNotificationsRead({ accountId, now: new Date() });
    return true;
  }

  async deleteSearchHistory(accountId: bigint, id: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const deleted = await this.repo.deleteSearchHistory({
      accountId,
      id,
      now: new Date(),
    });
    if (!deleted) throw new NotFoundException('Search history not found.');
    return true;
  }

  async clearSearchHistories(accountId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);
    await this.repo.clearSearchHistories({ accountId, now: new Date() });
    return true;
  }

  private async requireActiveUser(
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

  private toMePayload(account: ActiveUserAccount): MePayload {
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

  private normalizeNickname(raw: string): string {
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

  private normalizeName(raw?: string | null): string | null {
    if (raw === undefined || raw === null) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizePhoneNumber(raw?: string | null): string | null {
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

  private normalizeBirthDate(raw?: Date | string | null): Date | null {
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

  private normalizePaginationInput(input?: {
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

type ActiveUserAccount = UserAccountWithProfile & {
  deleted_at: null;
  user_profile: NonNullable<UserAccountWithProfile['user_profile']> & {
    deleted_at: null;
  };
};
