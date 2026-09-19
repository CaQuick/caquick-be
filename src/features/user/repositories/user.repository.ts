import { Injectable } from '@nestjs/common';

import { Prisma } from '@/generated/prisma/client';
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

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

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
