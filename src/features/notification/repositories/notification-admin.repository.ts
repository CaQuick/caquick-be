import { Injectable } from '@nestjs/common';

import type {
  AdminNotificationTargetKindValue,
  AdminNotificationTypeValue,
} from '@/features/notification/constants/notification-admin.constants';
import { type OutboxEventInput, OutboxPublisher } from '@/features/outbox';
import {
  AccountType,
  type NotificationBroadcast,
  type Prisma,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/** 발송 요청 시점에 확정한 이력 값. event_id는 이벤트에서 가져온다. */
export interface NotificationBroadcastRecord {
  actorAccountId: bigint;
  actorLabel: string | null;
  type: AdminNotificationTypeValue;
  title: string;
  body: string;
  targetKind: AdminNotificationTargetKindValue;
  targetCount: number;
  /** ACCOUNT_IDS만 대상 ID, ALL_USERS는 null. */
  targetAccountIds: string[] | null;
  skippedAccountIds: string[];
  requestedAt: Date;
}

export interface NotificationBroadcastFilter {
  type?: AdminNotificationTypeValue;
  targetKind?: AdminNotificationTargetKindValue;
}

/** 관리자 일괄 발송의 대상 계정 조회와 발송 요청 이벤트 적재. */
@Injectable()
export class NotificationAdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisher,
  ) {}

  /** ALL_USERS 대상 확정 — 전원을 싣는 대신 요청 시점 컷오프(최대 id)와 건수만 남긴다. */
  async snapshotActiveUserAudience(): Promise<{
    maxAccountId: bigint | null;
    count: number;
  }> {
    const result = await this.prisma.account.aggregate({
      where: { account_type: AccountType.USER, status: 'ACTIVE' },
      _count: { _all: true },
      _max: { id: true },
    });
    return { maxAccountId: result._max.id, count: result._count._all };
  }

  /** 소비자가 컷오프(maxId) 이하 활성 USER를 키셋으로 훑는다. */
  async listActiveUserAccountIds(args: {
    afterId?: bigint;
    maxId?: bigint;
    limit: number;
  }): Promise<bigint[]> {
    const rows = await this.prisma.account.findMany({
      where: {
        account_type: AccountType.USER,
        status: 'ACTIVE',
        ...(args.afterId !== undefined || args.maxId !== undefined
          ? {
              id: {
                ...(args.afterId !== undefined ? { gt: args.afterId } : {}),
                ...(args.maxId !== undefined ? { lte: args.maxId } : {}),
              },
            }
          : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: args.limit,
    });
    return rows.map((r) => r.id);
  }

  async filterActiveUserAccountIds(ids: bigint[]): Promise<bigint[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.account.findMany({
      where: {
        id: { in: ids },
        account_type: AccountType.USER,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * 발송 요청을 이벤트 1건으로 적재한다(fan-out은 소비자). 새로 적재된 경우에만 발송 이력과 onCreated(감사 기록)를 같은 tx에서
   * 남겨 "요청은 큐에 남고 이력·감사만 빠지는" 상태를 막는다. 같은 eventId면 적재하지 않고 처음 payload·이력 ID를 돌려준다.
   * 같은 키의 동시 요청이 unique에 걸리면 tx 밖에서 승자의 이벤트·이력을 다시 읽어 재생한다.
   */
  async requestBroadcast(
    event: OutboxEventInput & { eventId: string },
    record: NotificationBroadcastRecord,
    onCreated: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<{
    created: boolean;
    payload: Prisma.JsonValue;
    broadcastId: bigint;
  }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await this.outbox.publishOnce(tx, event);
        if (!result.created) {
          return {
            created: false,
            payload: result.payload,
            broadcastId: await findBroadcastId(tx, event.eventId),
          };
        }
        const broadcast = await tx.notificationBroadcast.create({
          data: toBroadcastCreate(event.eventId, record),
          select: { id: true },
        });
        await onCreated(tx);
        return {
          created: true,
          payload: result.payload,
          broadcastId: broadcast.id,
        };
      });
    } catch (error) {
      if (OutboxPublisher.isDuplicateEvent(error)) {
        const winner = await this.outbox.findPublished(event.eventId);
        if (winner) {
          return {
            created: false,
            payload: winner.payload,
            broadcastId: await findBroadcastId(this.prisma, event.eventId),
          };
        }
      }
      throw error;
    }
  }

  async listBroadcasts(
    args: NotificationBroadcastFilter & { limit: number; cursor?: bigint },
  ): Promise<NotificationBroadcast[]> {
    return this.prisma.notificationBroadcast.findMany({
      where: {
        ...broadcastWhere(args),
        ...(args.cursor !== undefined ? { id: { lt: args.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countBroadcasts(filter: NotificationBroadcastFilter): Promise<number> {
    return this.prisma.notificationBroadcast.count({
      where: broadcastWhere(filter),
    });
  }

  /** 미완료 이력의 지금까지 저장된 알림 수(source_event_id별). 알림이 없는 이벤트는 결과에 없다. */
  async countDeliveredByEventIds(
    eventIds: string[],
  ): Promise<Map<string, number>> {
    if (eventIds.length === 0) return new Map();
    const rows = await this.prisma.notification.groupBy({
      by: ['source_event_id'],
      where: { source_event_id: { in: eventIds } },
      _count: { _all: true },
    });
    return new Map(
      rows.flatMap((r) =>
        r.source_event_id === null ? [] : [[r.source_event_id, r._count._all]],
      ),
    );
  }

  /**
   * fan-out을 마친 뒤 완료를 기록한다. 재전달에도 멱등이게 저장 수는 매번 다시 세어 덮고 완료 시각은 비어 있을 때만 쓴다.
   * 이력 행이 없으면(백필에서 빠진 옛 요청) false.
   */
  async markBroadcastCompleted(
    eventId: string,
    completedAt: Date,
  ): Promise<boolean> {
    const delivered = await this.prisma.notification.count({
      where: { source_event_id: eventId },
    });
    const { count } = await this.prisma.notificationBroadcast.updateMany({
      where: { event_id: eventId },
      data: { delivered_count: delivered },
    });
    if (count === 0) return false;
    await this.prisma.notificationBroadcast.updateMany({
      where: { event_id: eventId, completed_at: null },
      data: { completed_at: completedAt },
    });
    return true;
  }
}

function broadcastWhere(
  filter: NotificationBroadcastFilter,
): Prisma.NotificationBroadcastWhereInput {
  return {
    ...(filter.type !== undefined ? { type: filter.type } : {}),
    ...(filter.targetKind !== undefined
      ? { target_kind: filter.targetKind }
      : {}),
  };
}

function toBroadcastCreate(
  eventId: string,
  r: NotificationBroadcastRecord,
): Prisma.NotificationBroadcastCreateInput {
  return {
    event_id: eventId,
    actor_account_id: r.actorAccountId,
    actor_label: r.actorLabel,
    type: r.type,
    title: r.title,
    body: r.body,
    target_kind: r.targetKind,
    target_count: r.targetCount,
    skipped_count: r.skippedAccountIds.length,
    ...(r.targetAccountIds !== null
      ? { target_account_ids: r.targetAccountIds }
      : {}),
    skipped_account_ids: r.skippedAccountIds,
    created_at: r.requestedAt,
  };
}

/** outbox 이벤트가 있으면 이력도 있다(같은 tx 적재 + 과거분 백필). 없으면 불변식이 깨진 것이라 던진다. */
async function findBroadcastId(
  client: Pick<Prisma.TransactionClient, 'notificationBroadcast'>,
  eventId: string,
): Promise<bigint> {
  const row = await client.notificationBroadcast.findUnique({
    where: { event_id: eventId },
    select: { id: true },
  });
  if (!row) throw new Error(`알림 발송 이력 없음: ${eventId}`);
  return row.id;
}
