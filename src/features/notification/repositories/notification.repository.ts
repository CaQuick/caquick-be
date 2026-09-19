import { Injectable } from '@nestjs/common';

import {
  type NotificationEvent,
  type NotificationType,
  Prisma,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

/** 표시값(매장명·상품명·주문번호)은 생성 시점 스냅샷 컬럼 — 조회가 다른 도메인을 조인하지 않는다. */
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
  store_name: true,
  product_name: true,
  order_number: true,
} satisfies Prisma.NotificationSelect;

export type NotificationListRow = Prisma.NotificationGetPayload<{
  select: typeof notificationListSelect;
}>;

/** outbox 소비자가 만드는 알림 1건. 표시값은 이벤트 payload의 생산 시점 스냅샷. */
export interface NotificationEventRow {
  account_id: bigint;
  type: NotificationType;
  event: NotificationEvent | null;
  title: string;
  body: string;
  store_id?: bigint | null;
  product_id?: bigint | null;
  order_id?: bigint | null;
  review_id?: bigint | null;
  store_name?: string | null;
  product_name?: string | null;
  order_number?: string | null;
  /** 이벤트 발생 시각(outbox occurred_at) */
  created_at: Date;
}

/** 구매자 알림센터(목록·미읽 수·읽음 처리)와 이벤트 소비 저장. 알림 생성은 outbox 소비자만 한다. */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * at-least-once 재전달 흡수: 같은 이벤트로 이미 들어간 계정은 빼고 넣는다(unique (source_event_id, account_id)가 최종 방어).
   * skipDuplicates(INSERT IGNORE)는 FK 위반 같은 다른 오류까지 삼켜 조용히 0건이 되므로 쓰지 않는다. 반환은 새로 들어간 건수.
   */
  async createFromEvent(
    sourceEventId: string,
    rows: NotificationEventRow[],
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const delivered = new Set(
      (
        await this.prisma.notification.findMany({
          where: {
            source_event_id: sourceEventId,
            account_id: { in: rows.map((row) => row.account_id) },
          },
          select: { account_id: true },
        })
      ).map((row) => row.account_id.toString()),
    );
    const fresh = rows.filter(
      (row) => !delivered.has(row.account_id.toString()),
    );
    if (fresh.length === 0) return 0;
    const result = await this.prisma.notification.createMany({
      data: fresh.map((row) => ({
        account_id: row.account_id,
        type: row.type,
        event: row.event,
        title: row.title,
        body: row.body,
        store_id: row.store_id ?? null,
        product_id: row.product_id ?? null,
        order_id: row.order_id ?? null,
        review_id: row.review_id ?? null,
        store_name: row.store_name ?? null,
        product_name: row.product_name ?? null,
        order_number: row.order_number ?? null,
        created_at: row.created_at,
        source_event_id: sourceEventId,
      })),
    });
    return result.count;
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
}
