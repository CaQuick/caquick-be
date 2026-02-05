import { Injectable } from '@nestjs/common';
import { AccountType, NotificationType } from '@prisma/client';

import { PrismaService } from '../../../prisma';

export interface UserAccountWithProfile {
  id: bigint;
  account_type: AccountType;
  email: string | null;
  name: string | null;
  deleted_at: Date | null;
  user_profile: {
    nickname: string;
    birth_date: Date | null;
    phone_number: string | null;
    profile_image_url: string | null;
    onboarding_completed_at: Date | null;
    deleted_at: Date | null;
  } | null;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  private activeRelationWhere<T extends Record<string, unknown>>(
    where: T,
  ): T & { deleted_at: null } {
    return { ...where, deleted_at: null };
  }

  async findAccountWithProfile(
    accountId: bigint,
    options?: { withDeleted?: boolean },
  ): Promise<UserAccountWithProfile | null> {
    const where = {
      id: accountId,
      ...(options?.withDeleted ? { deleted_at: undefined } : {}),
    };
    const args = {
      where,
      include: {
        user_profile: true,
      },
    };
    return this.prisma.account.findFirst(args);
  }

  async isNicknameTaken(
    nickname: string,
    excludeAccountId?: bigint,
  ): Promise<boolean> {
    const found = await this.prisma.userProfile.findFirst({
      where: {
        nickname,
        ...(excludeAccountId ? { account_id: { not: excludeAccountId } } : {}),
      },
      select: { id: true },
    });
    return Boolean(found);
  }

  async completeOnboarding(args: {
    accountId: bigint;
    name?: string | null;
    nickname: string;
    birthDate?: Date | null;
    phoneNumber?: string | null;
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (args.name) {
        await tx.account.updateMany({
          where: { id: args.accountId, name: null },
          data: { name: args.name },
        });
      }

      await tx.userProfile.update({
        where: { account_id: args.accountId },
        data: {
          nickname: args.nickname,
          birth_date: args.birthDate ?? null,
          phone_number: args.phoneNumber ?? null,
          onboarding_completed_at: args.now,
        },
      });
    });
  }

  async updateProfile(args: {
    accountId: bigint;
    nickname?: string;
    birthDate?: Date | null;
    phoneNumber?: string | null;
  }): Promise<void> {
    await this.prisma.userProfile.update({
      where: { account_id: args.accountId },
      data: {
        ...(args.nickname !== undefined ? { nickname: args.nickname } : {}),
        ...(args.birthDate !== undefined ? { birth_date: args.birthDate } : {}),
        ...(args.phoneNumber !== undefined
          ? { phone_number: args.phoneNumber }
          : {}),
      },
    });
  }

  async updateProfileImage(args: {
    accountId: bigint;
    profileImageUrl: string | null;
  }): Promise<void> {
    await this.prisma.userProfile.update({
      where: { account_id: args.accountId },
      data: { profile_image_url: args.profileImageUrl },
    });
  }

  async softDeleteAccount(args: {
    accountId: bigint;
    deletedNickname: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userProfile.update({
        where: { account_id: args.accountId },
        data: {
          nickname: args.deletedNickname,
          deleted_at: args.now,
        },
      });

      await tx.account.update({
        where: { id: args.accountId },
        data: {
          deleted_at: args.now,
          email: null,
        },
      });

      await tx.authRefreshSession.updateMany({
        where: {
          account_id: args.accountId,
          revoked_at: null,
          deleted_at: null,
        },
        data: {
          revoked_at: args.now,
          deleted_at: args.now,
        },
      });
    });
  }

  async getViewerCounts(accountId: bigint): Promise<{
    unreadNotificationCount: number;
    cartItemCount: number;
    wishlistCount: number;
  }> {
    const [unreadNotificationCount, cartItemCount, wishlistCount] =
      await this.prisma.$transaction([
        this.prisma.notification.count({
          where: {
            account_id: accountId,
            read_at: null,
          },
        }),
        this.prisma.cartItem.count({
          where: {
            cart: this.activeRelationWhere({ account_id: accountId }),
          },
        }),
        this.prisma.wishlistItem.count({
          where: {
            account_id: accountId,
          },
        }),
      ]);

    return { unreadNotificationCount, cartItemCount, wishlistCount };
  }

  async listNotifications(args: {
    accountId: bigint;
    unreadOnly: boolean;
    offset: number;
    limit: number;
  }): Promise<{
    items: {
      id: bigint;
      type: NotificationType;
      title: string;
      body: string;
      read_at: Date | null;
      created_at: Date;
    }[];
    totalCount: number;
  }> {
    const where = {
      account_id: args.accountId,
      ...(args.unreadOnly ? { read_at: null } : {}),
    };

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: args.offset,
        take: args.limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          read_at: true,
          created_at: true,
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, totalCount };
  }

  async markNotificationRead(args: {
    accountId: bigint;
    notificationId: bigint;
    now: Date;
  }): Promise<boolean> {
    const found = await this.prisma.notification.findFirst({
      where: {
        id: args.notificationId,
        account_id: args.accountId,
      },
    });

    if (!found) return false;

    if (!found.read_at) {
      await this.prisma.notification.update({
        where: { id: found.id },
        data: { read_at: args.now },
      });
    }

    return true;
  }

  async markAllNotificationsRead(args: {
    accountId: bigint;
    now: Date;
  }): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        account_id: args.accountId,
        deleted_at: null,
        read_at: null,
      },
      data: { read_at: args.now },
    });

    return result.count;
  }

  async listSearchHistories(args: {
    accountId: bigint;
    offset: number;
    limit: number;
  }): Promise<{
    items: {
      id: bigint;
      keyword: string;
      last_used_at: Date;
    }[];
    totalCount: number;
  }> {
    const where = {
      account_id: args.accountId,
    };

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.searchHistory.findMany({
        where,
        orderBy: { last_used_at: 'desc' },
        skip: args.offset,
        take: args.limit,
        select: {
          id: true,
          keyword: true,
          last_used_at: true,
        },
      }),
      this.prisma.searchHistory.count({ where }),
    ]);

    return { items, totalCount };
  }

  async deleteSearchHistory(args: {
    accountId: bigint;
    id: bigint;
    now: Date;
  }): Promise<boolean> {
    const result = await this.prisma.searchHistory.updateMany({
      where: {
        id: args.id,
        account_id: args.accountId,
        deleted_at: null,
      },
      data: { deleted_at: args.now },
    });
    return result.count > 0;
  }

  async clearSearchHistories(args: {
    accountId: bigint;
    now: Date;
  }): Promise<number> {
    const result = await this.prisma.searchHistory.updateMany({
      where: {
        account_id: args.accountId,
        deleted_at: null,
      },
      data: { deleted_at: args.now },
    });
    return result.count;
  }
}
