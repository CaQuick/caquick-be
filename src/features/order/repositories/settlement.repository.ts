import { Inject, Injectable } from '@nestjs/common';

import { formatDateOnly } from '@/common/utils/kst-time';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { settlementCreatedEvent } from '@/features/order/events/settlement-created.event';
import { OutboxPublisher } from '@/features/outbox';
import {
  AuditActionType,
  AuditTargetType,
  Prisma,
  SettlementStatus,
  type Settlement,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

/** 정산 매장은 주문의 첫 품목(남은 품목 중 id가 가장 작은 것)이 정한다 — 주문 1건 = 매장 1곳. */
const FIRST_ITEM_JOIN = Prisma.sql`JOIN order_item oi ON oi.id = (
  SELECT MIN(i.id) FROM order_item i WHERE i.order_id = o.id AND i.deleted_at IS NULL)`;

/** 정산이 확정됐지만 아직 주간 정산에 묶이지 않은 주문. raw라 deleted_at을 직접 건다. */
function unsettledBefore(before: Date): Prisma.Sql {
  return Prisma.sql`o.settlement_finalized_at < ${before}
    AND o.settlement_id IS NULL AND o.settlement_base_amount > 0
    AND o.deleted_at IS NULL`;
}

export const settlementDetailInclude = {
  orders: {
    where: activeWhere,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      order_number: true,
      status: true,
      commission_rate_bps: true,
      settlement_base_amount: true,
      commission_amount: true,
      settlement_finalized_at: true,
      items: {
        where: activeWhere,
        orderBy: { id: 'asc' },
        take: 1,
        select: { product_name_snapshot: true },
      },
    },
  },
} satisfies Prisma.SettlementInclude;

export type SettlementDetailRow = Prisma.SettlementGetPayload<{
  include: typeof settlementDetailInclude;
}>;

export interface SettlementListFilter {
  storeId?: bigint;
  status?: SettlementStatus;
  /** `@db.Date` 값 */
  periodStart?: Date;
}

export type MarkSettlementPaidResult =
  | { kind: 'paid' }
  | { kind: 'not-found' }
  | { kind: 'already-paid' }
  | { kind: 'account-required' };

export interface MonthlyCommissionRow {
  storeId: bigint;
  storeName: string;
  orderCount: number;
  settlementBaseAmount: number;
  commissionAmount: number;
}

@Injectable()
export class SettlementRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisher,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  async findUnsettledStoreIds(before: Date): Promise<bigint[]> {
    const rows = await this.prisma.$queryRaw<{ store_id: bigint }[]>`
      SELECT DISTINCT oi.store_id FROM \`order\` o ${FIRST_ITEM_JOIN}
      WHERE ${unsettledBefore(before)}
      ORDER BY oi.store_id`;
    return rows.map((row) => row.store_id);
  }

  /**
   * 한 매장의 주간 정산. 주문 행을 id 순으로 잠근 뒤 다시 골라 합계를 내고, 정산 행·주문 연결·outbox를 한 tx에 남긴다.
   * 그 기간 정산이 이미 있거나(재실행) 묶을 주문이 없으면 만들지 않는다 — 남은 주문은 다음 주 정산에 들어간다.
   */
  async createWeeklySettlement(args: {
    storeId: bigint;
    /** 이 시각 전에 확정된 주문을 묶는다(이번 주 월요일 00:00 KST) */
    settledBefore: Date;
    periodStart: Date;
    periodEnd: Date;
    now: Date;
  }): Promise<Settlement | null> {
    return this.prisma.$transaction(async (tx) => {
      const orders = await tx.$queryRaw<
        { id: bigint; base: bigint; commission: bigint; store_name: string }[]
      >`
        SELECT o.id, o.settlement_base_amount AS base, COALESCE(o.commission_amount, 0) AS commission,
               oi.store_name_snapshot AS store_name
        FROM \`order\` o ${FIRST_ITEM_JOIN}
        WHERE ${unsettledBefore(args.settledBefore)} AND oi.store_id = ${args.storeId}
        ORDER BY o.id
        FOR UPDATE OF o`;
      if (orders.length === 0) return null;
      const existing = await tx.settlement.findUnique({
        where: {
          store_id_period_start: {
            store_id: args.storeId,
            period_start: args.periodStart,
          },
        },
        select: { id: true },
      });
      if (existing) return null;

      // raw는 INT UNSIGNED를 bigint로 돌려준다
      const base = orders.reduce((sum, o) => sum + Number(o.base), 0);
      const commission = orders.reduce(
        (sum, o) => sum + Number(o.commission),
        0,
      );
      const settlement = await tx.settlement.create({
        data: {
          store_id: args.storeId,
          // 가장 최근 주문의 매장명
          store_name_snapshot: orders[orders.length - 1].store_name,
          period_start: args.periodStart,
          period_end: args.periodEnd,
          order_count: orders.length,
          settlement_base_amount: base,
          commission_amount: commission,
          payout_amount: base - commission,
        },
      });
      await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { settlement_id: settlement.id },
      });
      await this.outbox.publish(
        tx,
        settlementCreatedEvent(
          {
            settlementId: settlement.id.toString(),
            storeId: args.storeId.toString(),
            storeName: settlement.store_name_snapshot,
            periodStart: formatDateOnly(args.periodStart),
            periodEnd: formatDateOnly(args.periodEnd),
            orderCount: settlement.order_count,
            settlementBaseAmount: base,
            commissionAmount: commission,
            payoutAmount: settlement.payout_amount,
          },
          args.now,
        ),
      );
      return settlement;
    });
  }

  private listWhere(filter: SettlementListFilter): Prisma.SettlementWhereInput {
    return {
      ...(filter.storeId !== undefined ? { store_id: filter.storeId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.periodStart ? { period_start: filter.periodStart } : {}),
    };
  }

  /** 최근 생성 순(id 내림차순). */
  async list(
    filter: SettlementListFilter & { limit: number; cursor?: bigint },
  ): Promise<Settlement[]> {
    return this.prisma.settlement.findMany({
      where: {
        ...this.listWhere(filter),
        ...(filter.cursor !== undefined ? { id: { lt: filter.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: filter.limit + 1,
    });
  }

  async count(filter: SettlementListFilter): Promise<number> {
    return this.prisma.settlement.count({ where: this.listWhere(filter) });
  }

  /** storeId를 주면 그 매장 정산만 찾는다. */
  async findDetail(
    settlementId: bigint,
    storeId?: bigint,
  ): Promise<SettlementDetailRow | null> {
    return this.prisma.settlement.findFirst({
      where: {
        id: settlementId,
        ...(storeId !== undefined ? { store_id: storeId } : {}),
      },
      include: settlementDetailInclude,
    });
  }

  /**
   * 송금 완료. 그 시점 매장 정산 계좌를 paid_*에 옮겨 적는다(암호문은 같은 용도 키라 그대로 복사).
   * 감사에는 끝 4자리만 남긴다.
   */
  async markPaid(args: {
    settlementId: bigint;
    actorAccountId: bigint;
    actorLabel: string | null;
    note: string | null;
    now: Date;
  }): Promise<MarkSettlementPaidResult> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { id: bigint; store_id: bigint; status: SettlementStatus }[]
      >`SELECT id, store_id, status FROM settlement WHERE id = ${args.settlementId} FOR UPDATE`;
      if (!locked) return { kind: 'not-found' };
      if (locked.status !== SettlementStatus.PENDING) {
        return { kind: 'already-paid' };
      }
      const account = await tx.storeSettlementAccount.findUnique({
        where: { store_id: locked.store_id },
      });
      if (!account) return { kind: 'account-required' };

      const paid = await tx.settlement.update({
        where: { id: locked.id },
        data: {
          status: SettlementStatus.PAID,
          paid_at: args.now,
          paid_by_account_id: args.actorAccountId,
          paid_by_label_snapshot: args.actorLabel,
          paid_note: args.note,
          paid_bank_code: account.bank_code,
          paid_account_holder: account.account_holder,
          paid_account_number_enc: account.account_number_enc,
          paid_account_last4: account.account_number_last4,
        },
      });
      await this.auditLogs.recordAudit(tx, {
        actorAccountId: args.actorAccountId,
        storeId: locked.store_id,
        targetType: AuditTargetType.SETTLEMENT,
        targetId: locked.id,
        action: AuditActionType.STATUS_CHANGE,
        beforeJson: { status: SettlementStatus.PENDING },
        afterJson: {
          status: SettlementStatus.PAID,
          payoutAmount: paid.payout_amount,
          bank_code: account.bank_code,
          account_holder: account.account_holder,
          account_number_last4: account.account_number_last4,
          note: args.note,
        },
      });
      return { kind: 'paid' };
    });
  }

  async countPending(): Promise<number> {
    return this.prisma.settlement.count({
      where: { status: SettlementStatus.PENDING },
    });
  }

  /** [from, to)에 정산이 확정된 주문을 매장별로 묶는다. 매장명은 그 달 가장 최근 주문의 것. */
  async monthlyCommissions(
    from: Date,
    to: Date,
  ): Promise<MonthlyCommissionRow[]> {
    const rows = await this.prisma.$queryRaw<
      {
        store_id: bigint;
        store_name: string;
        order_count: bigint;
        base: bigint;
        commission: bigint;
      }[]
    >`
      SELECT t.store_id, t.store_name, COUNT(*) AS order_count,
             CAST(SUM(t.base) AS UNSIGNED) AS base, CAST(SUM(t.commission) AS UNSIGNED) AS commission
      FROM (
        SELECT oi.store_id, o.settlement_base_amount AS base, COALESCE(o.commission_amount, 0) AS commission,
               FIRST_VALUE(oi.store_name_snapshot) OVER (PARTITION BY oi.store_id ORDER BY o.id DESC) AS store_name
        FROM \`order\` o ${FIRST_ITEM_JOIN}
        WHERE o.settlement_finalized_at >= ${from} AND o.settlement_finalized_at < ${to}
          AND o.settlement_base_amount > 0 AND o.deleted_at IS NULL
      ) t
      GROUP BY t.store_id, t.store_name
      ORDER BY t.store_id`;
    return rows.map((row) => ({
      storeId: row.store_id,
      storeName: row.store_name,
      orderCount: Number(row.order_count),
      settlementBaseAmount: Number(row.base),
      commissionAmount: Number(row.commission),
    }));
  }
}
