import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { refundAccountSubmittedEvent } from '@/features/order/events/refund-account-submitted.event';
import { refundCompletedEvent } from '@/features/order/events/refund-completed.event';
import type { RefundEventArgs } from '@/features/order/events/refund-requested.event';
import { OutboxPublisher } from '@/features/outbox';
import {
  AuditActionType,
  AuditTargetType,
  type Prisma,
  type Refund,
  type RefundKind,
  RefundStatus,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

export const adminDepositRecordInclude = {
  order: { select: { order_number: true } },
  refund: { select: { id: true, status: true } },
} satisfies Prisma.DepositRecordInclude;

export type AdminDepositRecordRow = Prisma.DepositRecordGetPayload<{
  include: typeof adminDepositRecordInclude;
}>;

/** 관리자 목록·상세: 주문 식별·연락처, 첫 품목 스냅샷, 입금 반환이면 입금 기록. */
const adminRefundInclude = {
  order: {
    select: {
      order_number: true,
      buyer_name: true,
      buyer_phone: true,
      items: {
        where: activeWhere,
        select: { store_name_snapshot: true, product_name_snapshot: true },
        orderBy: { id: 'asc' },
        take: 1,
      },
    },
  },
  deposit_record: { include: adminDepositRecordInclude },
} satisfies Prisma.RefundInclude;

export type AdminRefundRow = Prisma.RefundGetPayload<{
  include: typeof adminRefundInclude;
}>;

export interface RefundFilter {
  status?: RefundStatus;
  kind?: RefundKind;
}

/** 서비스가 정규화·암호화한 환불 계좌. 원문 계좌번호는 repository로 내려오지 않는다. */
export interface RefundAccountData {
  bankCode: string;
  accountHolder: string;
  accountNumberEnc: string;
  accountNumberLast4: string;
}

/** 계좌가 들어오면 송금 대기다. 덮어쓰기도 같은 값으로 바꾼다. */
export function refundAccountColumns(account: RefundAccountData, now: Date) {
  return {
    status: RefundStatus.AWAITING_TRANSFER,
    bank_code: account.bankCode,
    account_holder: account.accountHolder,
    account_number_enc: account.accountNumberEnc,
    account_number_last4: account.accountNumberLast4,
    account_submitted_at: now,
  } satisfies Prisma.RefundUncheckedUpdateInput;
}

/** 환불 이벤트 스냅샷: 주문번호·구매자와 첫 품목의 매장·상품. */
export async function loadRefundEventArgs(
  tx: Prisma.TransactionClient,
  refund: Pick<Refund, 'id' | 'order_id' | 'kind' | 'amount'>,
  now: Date,
  actorAccountId: bigint | null,
): Promise<RefundEventArgs> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: refund.order_id },
    select: {
      order_number: true,
      account_id: true,
      items: {
        where: activeWhere,
        orderBy: { id: 'asc' },
        take: 1,
        select: {
          store_id: true,
          store_name_snapshot: true,
          product_id: true,
          product_name_snapshot: true,
        },
      },
    },
  });
  const [item] = order.items;
  return {
    refundId: refund.id,
    orderId: refund.order_id,
    orderNumber: order.order_number,
    buyerAccountId: order.account_id,
    kind: refund.kind,
    amount: refund.amount,
    storeId: item?.store_id ?? null,
    storeName: item?.store_name_snapshot ?? null,
    productId: item?.product_id ?? null,
    productName: item?.product_name_snapshot ?? null,
    occurredAt: now,
    actorAccountId,
  };
}

export type SubmitRefundAccountResult =
  { orderId: bigint } | 'not-found' | 'completed';

export type CompleteRefundResult =
  AdminRefundRow | 'not-found' | 'completed' | 'not-ready';

/** 환불(취소 환불·입금 반환)의 계좌 입력·송금 완료와 관리자 조회. 잠금은 환불 행 하나만 잡는다. */
@Injectable()
export class RefundRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisher,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  private filterWhere(filter: RefundFilter): Prisma.RefundWhereInput {
    return {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
    };
  }

  /** 처리 순서대로(오래된 환불부터). */
  async listRefunds(
    filter: RefundFilter & { limit: number; cursor?: bigint },
  ): Promise<AdminRefundRow[]> {
    return this.prisma.refund.findMany({
      where: {
        ...this.filterWhere(filter),
        ...(filter.cursor !== undefined ? { id: { gt: filter.cursor } } : {}),
      },
      include: adminRefundInclude,
      orderBy: { id: 'asc' },
      take: filter.limit + 1,
    });
  }

  async countRefunds(filter: RefundFilter): Promise<number> {
    return this.prisma.refund.count({ where: this.filterWhere(filter) });
  }

  async findAdminRefund(refundId: bigint): Promise<AdminRefundRow | null> {
    return this.prisma.refund.findUnique({
      where: { id: refundId },
      include: adminRefundInclude,
    });
  }

  /** 구매자 본인 환불의 계좌를 넣거나 바꾼다(송금 완료 전까지). */
  async submitAccount(args: {
    refundId: bigint;
    accountId: bigint;
    account: RefundAccountData;
    now: Date;
  }): Promise<SubmitRefundAccountResult> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Pick<Refund, 'id' | 'status'>[]>`
        SELECT r.id, r.status FROM refund r
        JOIN \`order\` o ON o.id = r.order_id
        WHERE r.id = ${args.refundId} AND o.account_id = ${args.accountId} AND o.deleted_at IS NULL
        FOR UPDATE OF r`;
      if (!locked) return 'not-found';
      if (locked.status === RefundStatus.COMPLETED) return 'completed';

      const updated = await tx.refund.update({
        where: { id: locked.id },
        data: refundAccountColumns(args.account, args.now),
      });
      await this.outbox.publish(
        tx,
        refundAccountSubmittedEvent(
          await loadRefundEventArgs(tx, updated, args.now, args.accountId),
        ),
      );
      return { orderId: updated.order_id };
    });
  }

  /** 송금 완료. 계좌가 들어온(송금 대기) 환불만 된다. */
  async complete(args: {
    refundId: bigint;
    actorAccountId: bigint;
    actorLabel: string | null;
    note: string | null;
    now: Date;
  }): Promise<CompleteRefundResult> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Pick<Refund, 'id' | 'status'>[]>`
        SELECT id, status FROM refund WHERE id = ${args.refundId} FOR UPDATE`;
      if (!locked) return 'not-found';
      if (locked.status === RefundStatus.COMPLETED) return 'completed';
      if (locked.status === RefundStatus.AWAITING_ACCOUNT) return 'not-ready';

      const updated = await tx.refund.update({
        where: { id: locked.id },
        data: {
          status: RefundStatus.COMPLETED,
          completed_at: args.now,
          completed_by_account_id: args.actorAccountId,
          completed_by_label_snapshot: args.actorLabel,
          complete_note: args.note,
        },
        include: adminRefundInclude,
      });
      await this.outbox.publish(
        tx,
        refundCompletedEvent(
          await loadRefundEventArgs(tx, updated, args.now, args.actorAccountId),
        ),
      );
      await this.auditLogs.recordAudit(tx, {
        actorAccountId: args.actorAccountId,
        targetType: AuditTargetType.REFUND,
        targetId: updated.id,
        action: AuditActionType.STATUS_CHANGE,
        beforeJson: { status: locked.status },
        afterJson: {
          status: RefundStatus.COMPLETED,
          orderId: updated.order_id.toString(),
          kind: updated.kind,
          amount: updated.amount,
          accountNumberLast4: updated.account_number_last4,
          note: args.note,
        },
      });
      return updated;
    });
  }
}
