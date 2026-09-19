import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  type NotificationType,
  Prisma,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

export interface AdminAuditLogFilter {
  actorAccountId?: bigint;
  storeId?: bigint;
  targetType?: AuditTargetType;
  targetId?: bigint;
  action?: AuditActionType;
  fromCreatedAt?: Date;
  toCreatedAt?: Date;
}

export type AdminAuditLogRow = Prisma.AuditLogGetPayload<
  Record<string, never>
> & {
  actor: { account_type: AccountType } | null;
};

@Injectable()
export class AdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  // ── 알림 발송 ──

  async listActiveUserAccountIds(args: {
    afterId?: bigint;
    limit: number;
  }): Promise<bigint[]> {
    const rows = await this.prisma.account.findMany({
      where: {
        account_type: AccountType.USER,
        status: 'ACTIVE',
        ...(args.afterId !== undefined ? { id: { gt: args.afterId } } : {}),
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

  /** event는 없다 — 시스템 이벤트가 아니다. */
  async createNotifications(
    accountIds: bigint[],
    payload: { type: NotificationType; title: string; body: string },
  ): Promise<number> {
    if (accountIds.length === 0) return 0;
    const result = await this.prisma.notification.createMany({
      data: accountIds.map((account_id) => ({
        account_id,
        type: payload.type,
        title: payload.title,
        body: payload.body,
      })),
    });
    return result.count;
  }

  // ── 감사 로그 전역 ──

  private auditLogWhere(args: AdminAuditLogFilter): Prisma.AuditLogWhereInput {
    return {
      ...(args.actorAccountId !== undefined
        ? { actor_account_id: args.actorAccountId }
        : {}),
      ...(args.storeId !== undefined ? { store_id: args.storeId } : {}),
      ...(args.targetType ? { target_type: args.targetType } : {}),
      ...(args.targetId !== undefined ? { target_id: args.targetId } : {}),
      ...(args.action ? { action: args.action } : {}),
      ...(args.fromCreatedAt || args.toCreatedAt
        ? {
            created_at: {
              ...(args.fromCreatedAt ? { gte: args.fromCreatedAt } : {}),
              ...(args.toCreatedAt ? { lte: args.toCreatedAt } : {}),
            },
          }
        : {}),
    };
  }

  async countAuditLogs(args: AdminAuditLogFilter): Promise<number> {
    return this.prisma.auditLog.count({ where: this.auditLogWhere(args) });
  }

  async listAuditLogs(
    args: AdminAuditLogFilter & { limit: number; cursor?: bigint },
  ): Promise<AdminAuditLogRow[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.auditLogWhere(args),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
    // AuditLog는 계정 FK가 없다(계정이 지워져도 기록을 남기기 위해). 행위자 종류는 한 번에 붙인다
    const actorIds = [...new Set(rows.map((r) => r.actor_account_id))];
    const actors = actorIds.length
      ? await this.prisma.account.findMany({
          where: { id: { in: actorIds }, deleted_at: undefined },
          select: { id: true, account_type: true },
        })
      : [];
    const typeById = new Map(
      actors.map((a) => [a.id.toString(), a.account_type]),
    );
    return rows.map((r) => ({
      ...r,
      actor: typeById.has(r.actor_account_id.toString())
        ? { account_type: typeById.get(r.actor_account_id.toString())! }
        : null,
    }));
  }

  // ── 대시보드 집계 ──

  async countAccountsCreatedBetween(
    accountType: AccountType,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.account.count({
      where: { account_type: accountType, created_at: { gte: from, lte: to } },
    });
  }

  async aggregateOrdersBetween(
    from: Date,
    to: Date,
  ): Promise<{
    counts: {
      submitted: number;
      confirmed: number;
      made: number;
      pickedUp: number;
      canceled: number;
    };
    amountSum: number;
  }> {
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: { created_at: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { total_price: true },
    });
    const counts = {
      submitted: 0,
      confirmed: 0,
      made: 0,
      pickedUp: 0,
      canceled: 0,
    };
    let amountSum = 0;
    for (const g of grouped) {
      const n = g._count._all;
      switch (g.status) {
        case 'SUBMITTED':
          counts.submitted = n;
          break;
        case 'CONFIRMED':
          counts.confirmed = n;
          break;
        case 'MADE':
          counts.made = n;
          break;
        case 'PICKED_UP':
          counts.pickedUp = n;
          break;
        case 'CANCELED':
          counts.canceled = n;
          break;
      }
      if (g.status !== 'CANCELED') amountSum += g._sum.total_price ?? 0;
    }
    return { counts, amountSum };
  }

  async countActiveStores(): Promise<number> {
    return this.prisma.store.count({ where: { is_active: true } });
  }

  async countActiveProducts(): Promise<number> {
    return this.prisma.product.count({ where: { is_active: true } });
  }

  async countPendingReviewReports(): Promise<number> {
    return this.prisma.reviewReport.count({ where: { status: 'PENDING' } });
  }
}
