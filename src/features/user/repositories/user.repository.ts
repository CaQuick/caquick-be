import { Injectable } from '@nestjs/common';

import { buildWithdrawnProviderSubject } from '@/common/utils/withdrawn-identity';
import {
  AccountType,
  IdentityProvider,
  Prisma,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

/**
 * order.items 폴백은 연관 ID를 저장하지 않던 과거 주문 알림 보강용 — 상품명은 주문 시점 스냅샷을 써 상품 삭제에도 안전하다.
 * nested select라 soft-delete 자동 필터가 닿지 않지만, 삭제된 매장·상품이어도 알림 표기용 이름은 그대로 보여주는 게 정책이다(이름만 노출, 이동은 FE 판단).
 */
const notificationListSelect = {
  id: true,
  type: true,
  event: true,
  title: true,
  body: true,
  read_at: true,
  created_at: true,
  store_id: true,
  product_id: true,
  order_id: true,
  review_id: true,
  store: { select: { store_name: true } },
  product: { select: { name: true } },
  order: {
    select: {
      items: {
        select: {
          store_id: true,
          product_id: true,
          product_name_snapshot: true,
          store: { select: { store_name: true } },
        },
        orderBy: { id: 'asc' as const },
        take: 1,
      },
    },
  },
} satisfies Prisma.NotificationSelect;

export type NotificationListRow = Prisma.NotificationGetPayload<{
  select: typeof notificationListSelect;
}>;

export interface UserAccountIdentity {
  provider: IdentityProvider;
  last_login_at: Date | null;
}

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
  account_identities: UserAccountIdentity[];
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAccountWithProfile(
    accountId: bigint,
    options?: { withDeleted?: boolean },
  ): Promise<UserAccountWithProfile | null> {
    return this.prisma.account.findFirst({
      where: {
        id: accountId,
        ...(options?.withDeleted ? { deleted_at: undefined } : {}),
      },
      include: {
        user_profile: true,
        // 최근 로그인 순으로 정렬해 FE가 "최근 로그인 provider"를 별도 정렬 없이 표시한다
        account_identities: {
          where: activeWhere,
          orderBy: [{ last_login_at: 'desc' }, { id: 'asc' }],
          select: { provider: true, last_login_at: true },
        },
      },
    });
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
    name?: string;
    birthDate?: Date | null;
    phoneNumber?: string | null;
  }): Promise<void> {
    const hasName = args.name !== undefined;
    const hasProfileFields =
      args.nickname !== undefined ||
      args.birthDate !== undefined ||
      args.phoneNumber !== undefined;

    // name은 account, 나머지는 user_profile — 두 테이블 부분 실패를 막으려고 트랜잭션으로 묶는다
    await this.prisma.$transaction(async (tx) => {
      if (hasName) {
        await tx.account.update({
          where: { id: args.accountId },
          data: { name: args.name },
        });
      }
      if (hasProfileFields) {
        await tx.userProfile.update({
          where: { account_id: args.accountId },
          data: {
            ...(args.nickname !== undefined ? { nickname: args.nickname } : {}),
            ...(args.birthDate !== undefined
              ? { birth_date: args.birthDate }
              : {}),
            ...(args.phoneNumber !== undefined
              ? { phone_number: args.phoneNumber }
              : {}),
          },
        });
      }
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

      await this.retireAccountIdentities(tx, args.accountId, args.now);

      await tx.authRefreshSession.updateMany({
        where: {
          account_id: args.accountId,
          revoked_at: null,
          ...activeWhere,
        },
        data: {
          revoked_at: args.now,
          deleted_at: args.now,
        },
      });
    });
  }

  /**
   * soft-delete만 하면 (provider, provider_subject) UNIQUE가 그대로 남아 같은 소셜 계정으로 재가입할 때
   * identity를 새로 만들 수 없다(MySQL unique index는 deleted_at을 보지 않는다). subject를 익명화해 자리를 비운다.
   * updateMany로는 기존 값 기반 갱신이 안 돼 row 단위로 처리한다(연동 수는 provider 수준이라 비용 무관).
   */
  private async retireAccountIdentities(
    tx: Prisma.TransactionClient,
    accountId: bigint,
    now: Date,
  ): Promise<void> {
    const identities = await tx.accountIdentity.findMany({
      where: { account_id: accountId },
      select: { id: true, provider_subject: true },
    });

    for (const identity of identities) {
      await tx.accountIdentity.update({
        where: { id: identity.id },
        data: {
          provider_subject: buildWithdrawnProviderSubject(
            accountId,
            identity.provider_subject,
          ),
          deleted_at: now,
        },
      });
    }
  }

  /** 3개월 밖 미읽 알림까지 세면 목록(myNotifications)과 배지 수가 어긋난다. */
  async countUnreadNotifications(args: {
    accountId: bigint;
    notificationSince: Date;
  }): Promise<number> {
    return this.prisma.notification.count({
      where: {
        account_id: args.accountId,
        read_at: null,
        created_at: { gte: args.notificationSince },
      },
    });
  }

  async listNotifications(args: {
    accountId: bigint;
    unreadOnly: boolean;
    limit: number;
    since: Date;
    cursor?: { createdAt: Date; id: bigint };
  }): Promise<{
    items: NotificationListRow[];
    totalCount: number;
  }> {
    const where: Prisma.NotificationWhereInput = {
      account_id: args.accountId,
      created_at: { gte: args.since },
      ...(args.unreadOnly ? { read_at: null } : {}),
    };

    // (created_at, id) desc 키셋. created_at이 같은 행이 있어도 id 타이브레이크로
    // 페이지 중복/누락이 없다. since 조건과 키가 겹쳐 AND 배열로 분리한다.
    const pageWhere: Prisma.NotificationWhereInput = args.cursor
      ? {
          AND: [
            where,
            {
              OR: [
                { created_at: { lt: args.cursor.createdAt } },
                {
                  created_at: args.cursor.createdAt,
                  id: { lt: args.cursor.id },
                },
              ],
            },
          ],
        }
      : where;

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: pageWhere,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: args.limit + 1,
        select: notificationListSelect,
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
        ...activeWhere,
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
        ...activeWhere,
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
        ...activeWhere,
      },
      data: { deleted_at: args.now },
    });
    return result.count;
  }
}
