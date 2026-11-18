import { Inject, Injectable } from '@nestjs/common';

import type { TimestampIdCursor } from '@/common/utils/keyset-cursor';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { refundRequestedEvent } from '@/features/order/events/refund-requested.event';
import {
  adminDepositRecordInclude,
  type AdminDepositRecordRow,
  loadRefundEventArgs,
} from '@/features/order/repositories/refund.repository';
import { OutboxPublisher } from '@/features/outbox';
import {
  AuditActionType,
  AuditTargetType,
  type DepositRecord,
  DepositRecordKind,
  type Prisma,
  RefundKind,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

export interface DepositRecordInput {
  amount: number;
  depositorName: string;
  depositedAt: Date | null;
  note: string | null;
  actorAccountId: bigint;
  actorLabel: string | null;
  now: Date;
}

export type LinkDepositRecordResult =
  | AdminDepositRecordRow
  | 'order-not-found'
  | 'record-not-found'
  | 'already-linked';

function recordSnapshot(row: DepositRecord) {
  return {
    kind: row.kind,
    orderId: row.order_id?.toString() ?? null,
    amount: row.amount,
    depositorName: row.depositor_name,
    depositedAt: row.deposited_at?.toISOString() ?? null,
    note: row.note,
  };
}

/**
 * 결제로 확인하지 않은 입금 기록. 돌려줄 입금(RETURN)은 주문에 연결하고 입금액 전액 환불을 만든다 — 주문 상태·결제·정산은
 * 건드리지 않는다. 주인 모를 입금(UNIDENTIFIED)은 메모로 종결하고, 나중에 주인을 찾으면 같은 기록을 반환으로 바꾼다.
 */
@Injectable()
export class DepositRecordRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisher,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /** 최근 기록부터. */
  async listDepositRecords(args: {
    kind?: DepositRecordKind;
    limit: number;
    cursor?: TimestampIdCursor;
  }): Promise<AdminDepositRecordRow[]> {
    const after: Prisma.DepositRecordWhereInput = args.cursor
      ? {
          OR: [
            { created_at: { lt: args.cursor.timestamp } },
            { created_at: args.cursor.timestamp, id: { lt: args.cursor.id } },
          ],
        }
      : {};
    return this.prisma.depositRecord.findMany({
      where: { ...(args.kind ? { kind: args.kind } : {}), ...after },
      include: adminDepositRecordInclude,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: args.limit + 1,
    });
  }

  async countDepositRecords(kind?: DepositRecordKind): Promise<number> {
    return this.prisma.depositRecord.count({
      where: kind ? { kind } : {},
    });
  }

  /** 없는 주문이면 null. */
  async createReturn(
    args: DepositRecordInput & { orderId: bigint },
  ): Promise<AdminDepositRecordRow | null> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockOrder(tx, args.orderId))) return null;
      const record = await tx.depositRecord.create({
        data: {
          ...this.recordData(args),
          kind: DepositRecordKind.RETURN,
          order_id: args.orderId,
        },
      });
      await this.requestReturnRefund(tx, record, args);
      await this.audit(tx, args.actorAccountId, record, null);
      return this.findAdminRow(tx, record.id);
    });
  }

  async recordUnidentified(
    args: DepositRecordInput,
  ): Promise<AdminDepositRecordRow> {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.depositRecord.create({
        data: {
          ...this.recordData(args),
          kind: DepositRecordKind.UNIDENTIFIED,
        },
      });
      await this.audit(tx, args.actorAccountId, record, null);
      return this.findAdminRow(tx, record.id);
    });
  }

  /** 종결한 입금의 주인을 찾았을 때: 같은 기록을 반환으로 바꿔 주문에 잇는다(같은 돈을 두 번 기록하지 않는다). */
  async linkToOrder(args: {
    depositRecordId: bigint;
    orderId: bigint;
    actorAccountId: bigint;
    now: Date;
  }): Promise<LinkDepositRecordResult> {
    return this.prisma.$transaction(async (tx) => {
      // 잠금 순서 order → deposit_record
      if (!(await this.lockOrder(tx, args.orderId))) return 'order-not-found';
      const [locked] = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM deposit_record WHERE id = ${args.depositRecordId} FOR UPDATE`;
      if (!locked) return 'record-not-found';
      const before = await tx.depositRecord.findUniqueOrThrow({
        where: { id: locked.id },
      });
      if (before.kind !== DepositRecordKind.UNIDENTIFIED) {
        return 'already-linked';
      }
      const record = await tx.depositRecord.update({
        where: { id: before.id },
        data: { kind: DepositRecordKind.RETURN, order_id: args.orderId },
      });
      await this.requestReturnRefund(tx, record, args);
      await this.audit(tx, args.actorAccountId, record, before);
      return this.findAdminRow(tx, record.id);
    });
  }

  private async lockOrder(
    tx: Prisma.TransactionClient,
    orderId: bigint,
  ): Promise<boolean> {
    const [row] = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM \`order\` WHERE id = ${orderId} AND deleted_at IS NULL FOR UPDATE`;
    return Boolean(row);
  }

  private recordData(args: DepositRecordInput) {
    return {
      amount: args.amount,
      depositor_name: args.depositorName,
      deposited_at: args.depositedAt,
      note: args.note,
      recorded_by_account_id: args.actorAccountId,
      recorded_by_label_snapshot: args.actorLabel,
    };
  }

  /** 입금액 전액을 계좌 입력 대기 환불로 만들고 구매자 계좌 요청 이벤트를 남긴다. */
  private async requestReturnRefund(
    tx: Prisma.TransactionClient,
    record: DepositRecord,
    args: { actorAccountId: bigint; now: Date },
  ): Promise<void> {
    const refund = await tx.refund.create({
      data: {
        order_id: record.order_id!,
        kind: RefundKind.DEPOSIT_RETURN,
        deposit_record_id: record.id,
        amount: record.amount,
        requested_at: args.now,
      },
    });
    await this.outbox.publish(
      tx,
      refundRequestedEvent({
        ...(await loadRefundEventArgs(
          tx,
          refund,
          args.now,
          args.actorAccountId,
        )),
        accountSubmitted: false,
      }),
    );
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actorAccountId: bigint,
    after: DepositRecord,
    before: DepositRecord | null,
  ): Promise<void> {
    await this.auditLogs.recordAudit(tx, {
      actorAccountId,
      targetType: AuditTargetType.DEPOSIT_RECORD,
      targetId: after.id,
      action: before ? AuditActionType.UPDATE : AuditActionType.CREATE,
      beforeJson: before ? recordSnapshot(before) : null,
      afterJson: recordSnapshot(after),
    });
  }

  private findAdminRow(
    tx: Prisma.TransactionClient,
    id: bigint,
  ): Promise<AdminDepositRecordRow> {
    return tx.depositRecord.findUniqueOrThrow({
      where: { id },
      include: adminDepositRecordInclude,
    });
  }
}
