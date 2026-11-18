import { Inject, Injectable } from '@nestjs/common';

import { DAY_MS } from '@/common/utils/kst-time';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { orderStatusChangedEvent } from '@/features/order/events/order-status-changed.event';
import { orderSubmittedEvent } from '@/features/order/events/order-submitted.event';
import { refundRequestedEvent } from '@/features/order/events/refund-requested.event';
import type {
  OrderCancelDecision,
  OrderCancelState,
} from '@/features/order/policies/order-cancel.policy';
import type { OrderLockedState } from '@/features/order/policies/order-lifecycle.policy';
import {
  confirmedPaidAmount,
  finalizeSettlementLocked,
  lockPayment,
  type LockedPayment,
} from '@/features/order/repositories/order-settlement-finalizer.helper';
import {
  adminOrderInclude,
  type AdminOrderRow,
} from '@/features/order/repositories/order.repository';
import {
  refundAccountColumns,
  type RefundAccountData,
} from '@/features/order/repositories/refund.repository';
import { OutboxPublisher } from '@/features/outbox';
import {
  AuditActionType,
  AuditTargetType,
  OrderActor,
  OrderCancelFault,
  OrderStatus,
  PaymentConfirmSource,
  PaymentStatus,
  Prisma,
  RefundKind,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

/** 잠금 시점의 입금 확인 판정 재료. */
export interface PaymentConfirmState {
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus | null;
  paymentAmount: number | null;
  pickupAt: Date;
}

export interface ConfirmPaymentArgs {
  orderId: bigint;
  source: PaymentConfirmSource;
  actorAccountId: bigint;
  actorLabel: string | null;
  depositedAmount: number;
  note: string | null;
  now: Date;
  /** 잠금 뒤 상태로 다시 판정한다. 던지면 tx가 롤백되고 예외가 그대로 나간다. */
  assertConfirmable: (state: PaymentConfirmState) => void;
}

/** 취소 대상 범위. 범위 밖 주문은 없는 주문과 같다. */
export type OrderCancelScope =
  | { kind: 'any' }
  | { kind: 'buyer'; accountId: bigint }
  /** 판매자에게 보이는(접수된) 자기 매장 주문 */
  | { kind: 'store'; storeId: bigint };

export interface CancelOrderArgs {
  orderId: bigint;
  actor: OrderActor;
  /** 시스템 취소는 null(감사 기록 없음) */
  actorAccountId: bigint | null;
  scope: OrderCancelScope;
  note: string | null;
  /** 취소와 함께 받은 환불 계좌. 환불이 생기면 바로 송금 대기로 만들고, 환불이 없으면 버린다. */
  refundAccount?: RefundAccountData | null;
  now: Date;
  /** 크론 대상 조건을 잠금 뒤 다시 본다. false면 아무것도 바꾸지 않고 null이다(그사이 다른 전이·입금했어요). */
  eligible?: (state: OrderLockedState) => boolean;
  /** 잠금 시점 재료로 사유·사정·환불액을 정한다. 던지면 tx가 롤백되고 예외가 그대로 나간다. */
  decide: (state: OrderCancelState) => OrderCancelDecision;
}

export interface CompletePickupBySystemArgs {
  orderId: bigint;
  now: Date;
  /** 잠금 뒤 상태·픽업 시각으로 다시 판정한다. false면 아무것도 바꾸지 않고 null이다. */
  eligible: (state: OrderLockedState) => boolean;
}

export interface CompletePickupByAdminArgs {
  orderId: bigint;
  actorAccountId: bigint;
  note: string | null;
  now: Date;
  /** 잠금 뒤 상태·픽업 시각으로 판정한다. 던지면 tx가 롤백되고 예외가 그대로 나간다. */
  assertTransition: (state: OrderLockedState) => void;
}

/** 픽업 완료를 남기는 주체. 시스템 전이는 계정·메모가 없다. */
interface PickupActor {
  actor: OrderActor;
  actorAccountId: bigint | null;
  note: string | null;
  now: Date;
}

/** 접수 뒤 판매자 확정 마감: 확인 + 24시간과 픽업 시각 중 이른 쪽. */
const CONFIRM_WINDOW_MS = DAY_MS;

interface LockedOrderRow {
  id: bigint;
  status: OrderStatus;
  pickup_at: Date;
  commission_rate_bps: number;
  submitted_at: Date | null;
  confirm_deadline_at: Date | null;
}

async function lockOrder(
  tx: Prisma.TransactionClient,
  orderId: bigint,
  scopeSql: Prisma.Sql = Prisma.empty,
): Promise<LockedOrderRow | undefined> {
  const [row] = await tx.$queryRaw<LockedOrderRow[]>`
    SELECT o.id, o.status, o.pickup_at, o.commission_rate_bps, o.submitted_at, o.confirm_deadline_at
    FROM \`order\` o
    WHERE o.id = ${orderId} AND o.deleted_at IS NULL ${scopeSql}
    FOR UPDATE OF o`;
  return row;
}

function lockedState(
  order: LockedOrderRow,
  payment: LockedPayment | null,
): OrderLockedState {
  return {
    status: order.status,
    pickupAt: order.pickup_at,
    confirmDeadlineAt: order.confirm_deadline_at,
    payment,
  };
}

/** 이벤트 스냅샷용 첫 활성 품목(주문 1건 = 상품 1개). */
function firstItemOf(tx: Prisma.TransactionClient, orderId: bigint) {
  return tx.orderItem.findFirst({
    where: { order_id: orderId, ...activeWhere },
    orderBy: { id: 'asc' },
    select: {
      store_id: true,
      product_id: true,
      product_name_snapshot: true,
      store_name_snapshot: true,
      quantity: true,
    },
  });
}

function cancelScopeSql(scope: OrderCancelScope): Prisma.Sql {
  switch (scope.kind) {
    case 'buyer':
      return Prisma.sql`AND o.account_id = ${scope.accountId}`;
    case 'store':
      return Prisma.sql`AND o.submitted_at IS NOT NULL AND EXISTS (
        SELECT 1 FROM order_item i
        WHERE i.order_id = o.id AND i.store_id = ${scope.storeId} AND i.deleted_at IS NULL)`;
    default:
      return Prisma.empty;
  }
}

/** 주문 상태 전이 잠금 단위. 잠금 순서는 order → payment → refund. */
@Injectable()
export class OrderTransitionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisher,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /** 없는 주문이면 null. */
  async confirmPayment(
    args: ConfirmPaymentArgs,
  ): Promise<AdminOrderRow | null> {
    return this.prisma.$transaction((tx) =>
      this.confirmPaymentLocked(tx, args),
    );
  }

  /**
   * 입금 확인 → 접수. 결제 CONFIRMED, 주문 SUBMITTED(submitted_at으로 판매자에게 보이기 시작), 이력·감사(입금액 포함)·
   * outbox(order.status_changed + 판매자 '새 주문' order.submitted)를 같은 tx에 남긴다.
   */
  async confirmPaymentLocked(
    tx: Prisma.TransactionClient,
    args: ConfirmPaymentArgs,
  ): Promise<AdminOrderRow | null> {
    // 판정 재료는 잠금 읽기에서 가져온다 — 호출 tx가 앞서 만든 스냅샷은 그사이 커밋된 확인을 보지 못한다.
    const [locked] = await tx.$queryRaw<
      { id: bigint; status: OrderStatus; pickup_at: Date }[]
    >`
      SELECT id, status, pickup_at FROM \`order\`
      WHERE id = ${args.orderId} AND deleted_at IS NULL
      FOR UPDATE`;
    if (!locked) return null;
    const [payment] = await tx.$queryRaw<
      { id: bigint; status: PaymentStatus; amount: bigint }[]
    >`SELECT id, status, amount FROM payment WHERE order_id = ${locked.id} FOR UPDATE`;
    // raw는 INT UNSIGNED를 bigint로 돌려준다.
    const paymentAmount = payment ? Number(payment.amount) : null;
    args.assertConfirmable({
      orderStatus: locked.status,
      paymentStatus: payment?.status ?? null,
      paymentAmount,
      pickupAt: locked.pickup_at,
    });
    const confirmDeadlineAt = new Date(
      Math.min(
        args.now.getTime() + CONFIRM_WINDOW_MS,
        locked.pickup_at.getTime(),
      ),
    );
    const actorType =
      args.source === PaymentConfirmSource.ADMIN
        ? OrderActor.ADMIN
        : OrderActor.SYSTEM;

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.CONFIRMED,
        confirmed_at: args.now,
        confirm_source: args.source,
        confirmed_by_account_id: args.actorAccountId,
        confirmed_by_label_snapshot: args.actorLabel,
        confirm_note: args.note,
      },
    });
    const updated = await tx.order.update({
      where: { id: locked.id },
      data: {
        status: OrderStatus.SUBMITTED,
        submitted_at: args.now,
        confirm_deadline_at: confirmDeadlineAt,
      },
      include: adminOrderInclude,
    });
    await tx.orderStatusHistory.create({
      data: {
        order_id: locked.id,
        from_status: OrderStatus.PENDING_PAYMENT,
        to_status: OrderStatus.SUBMITTED,
        changed_at: args.now,
        actor_type: actorType,
        actor_account_id: args.actorAccountId,
      },
    });

    const firstItem = await firstItemOf(tx, locked.id);
    await this.outbox.publish(
      tx,
      orderStatusChangedEvent({
        orderId: locked.id,
        orderNumber: updated.order_number,
        buyerAccountId: updated.account_id,
        fromStatus: OrderStatus.PENDING_PAYMENT,
        toStatus: OrderStatus.SUBMITTED,
        storeId: firstItem?.store_id ?? null,
        storeName: firstItem?.store_name_snapshot ?? null,
        productId: firstItem?.product_id ?? null,
        productName: firstItem?.product_name_snapshot ?? null,
        actorType,
        pickupAt: updated.pickup_at,
        occurredAt: args.now,
        actorAccountId: args.actorAccountId,
      }),
    );
    if (firstItem) {
      await this.outbox.publish(
        tx,
        orderSubmittedEvent({
          orderId: locked.id,
          orderNumber: updated.order_number,
          buyerAccountId: updated.account_id,
          storeId: firstItem.store_id,
          storeName: firstItem.store_name_snapshot,
          productId: firstItem.product_id,
          productName: firstItem.product_name_snapshot,
          quantity: firstItem.quantity,
          pickupAt: updated.pickup_at,
          totalPrice: updated.total_price,
          confirmDeadlineAt,
          occurredAt: args.now,
          actorAccountId: args.actorAccountId,
        }),
      );
    }

    await this.auditLogs.recordAudit(tx, {
      actorAccountId: args.actorAccountId,
      storeId: firstItem?.store_id ?? null,
      targetType: AuditTargetType.ORDER,
      targetId: locked.id,
      action: AuditActionType.STATUS_CHANGE,
      beforeJson: { status: OrderStatus.PENDING_PAYMENT },
      afterJson: {
        status: OrderStatus.SUBMITTED,
        paymentAmount,
        depositedAmount: args.depositedAmount,
        confirmSource: args.source,
        note: args.note,
      },
    });
    return updated;
  }

  /** 없거나 범위 밖 주문이면 null. */
  async cancel(args: CancelOrderArgs): Promise<AdminOrderRow | null> {
    return this.prisma.$transaction((tx) => this.cancelLocked(tx, args));
  }

  /**
   * 취소. 판정(decide)은 잠금 읽기 결과로 한다. 입금 전 결제는 CANCELED로 닫고 확인된 결제는 그대로 둔다(돌려줄 돈은
   * 환불이 맡는다). 환불액이 있으면 환불(AWAITING_ACCOUNT)을, 구매자 사정 취소의 남는 금액은 정산 확정을 같은 tx에 남긴다.
   */
  async cancelLocked(
    tx: Prisma.TransactionClient,
    args: CancelOrderArgs,
  ): Promise<AdminOrderRow | null> {
    const locked = await lockOrder(
      tx,
      args.orderId,
      cancelScopeSql(args.scope),
    );
    if (!locked) return null;
    const payment = await lockPayment(tx, locked.id);
    if (args.eligible && !args.eligible(lockedState(locked, payment))) {
      return null;
    }
    const paidAmount = confirmedPaidAmount(payment);
    const decision = args.decide({ status: locked.status, paidAmount });

    if (payment?.status === PaymentStatus.PENDING) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.CANCELED, canceled_at: args.now },
      });
    }
    const updated = await tx.order.update({
      where: { id: locked.id },
      data: { status: OrderStatus.CANCELED, canceled_at: args.now },
      include: adminOrderInclude,
    });
    if (decision.fault === OrderCancelFault.BUYER) {
      await finalizeSettlementLocked(
        tx,
        locked,
        paidAmount - decision.refundAmount,
        args.now,
      );
    }
    await tx.orderStatusHistory.create({
      data: {
        order_id: locked.id,
        from_status: locked.status,
        to_status: OrderStatus.CANCELED,
        changed_at: args.now,
        actor_type: args.actor,
        actor_account_id: args.actorAccountId,
        cancel_reason: decision.reason,
        cancel_fault: decision.fault,
        refund_amount: decision.refundAmount,
        note: args.note,
      },
    });
    const refund =
      decision.refundAmount > 0
        ? await tx.refund.create({
            data: {
              order_id: locked.id,
              kind: RefundKind.CANCEL,
              cancel_order_id: locked.id,
              amount: decision.refundAmount,
              requested_at: args.now,
              ...(args.refundAccount
                ? refundAccountColumns(args.refundAccount, args.now)
                : {}),
            },
          })
        : null;

    const firstItem = await firstItemOf(tx, locked.id);
    const snapshot = {
      orderId: locked.id,
      orderNumber: updated.order_number,
      buyerAccountId: updated.account_id,
      storeId: firstItem?.store_id ?? null,
      storeName: firstItem?.store_name_snapshot ?? null,
      productId: firstItem?.product_id ?? null,
      productName: firstItem?.product_name_snapshot ?? null,
      occurredAt: args.now,
      actorAccountId: args.actorAccountId,
    };
    await this.outbox.publish(
      tx,
      orderStatusChangedEvent({
        ...snapshot,
        fromStatus: locked.status,
        toStatus: OrderStatus.CANCELED,
        actorType: args.actor,
        pickupAt: updated.pickup_at,
        cancelReason: decision.reason,
        refundAmount: decision.refundAmount,
      }),
    );
    if (refund) {
      await this.outbox.publish(
        tx,
        refundRequestedEvent({
          ...snapshot,
          refundId: refund.id,
          kind: refund.kind,
          amount: refund.amount,
          accountSubmitted: refund.account_submitted_at !== null,
        }),
      );
    }

    if (args.actorAccountId !== null) {
      await this.auditLogs.recordAudit(tx, {
        actorAccountId: args.actorAccountId,
        // 매장 id가 붙으면 판매자 감사 로그에 ip·ua까지 보인다 — 입금 전 주문과 구매자 행위는 비운다
        storeId:
          locked.submitted_at && args.actor !== OrderActor.BUYER
            ? (firstItem?.store_id ?? null)
            : null,
        targetType: AuditTargetType.ORDER,
        targetId: locked.id,
        action: AuditActionType.STATUS_CHANGE,
        beforeJson: { status: locked.status },
        afterJson: {
          status: OrderStatus.CANCELED,
          actorType: args.actor,
          reason: decision.reason,
          fault: decision.fault,
          refundAmount: decision.refundAmount,
          note: args.note,
        },
      });
    }
    return updated;
  }

  /**
   * 자동 픽업 완료(SYSTEM). 잠금 뒤 다시 판정해 그사이 판매자가 처리했거나 픽업이 바뀐 주문은 건너뛴다.
   * 시스템 전이라 감사 기록은 없다.
   */
  async completePickupBySystem(
    args: CompletePickupBySystemArgs,
  ): Promise<AdminOrderRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockOrder(tx, args.orderId);
      if (!locked) return null;
      const payment = await lockPayment(tx, locked.id);
      if (!args.eligible(lockedState(locked, payment))) return null;
      return this.completePickupLocked(tx, locked, payment, {
        actor: OrderActor.SYSTEM,
        actorAccountId: null,
        note: null,
        now: args.now,
      });
    });
  }

  /** 관리자 픽업 완료(매장 숨김과 무관). 없는 주문이면 null. */
  async completePickupByAdmin(
    args: CompletePickupByAdminArgs,
  ): Promise<AdminOrderRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockOrder(tx, args.orderId);
      if (!locked) return null;
      const payment = await lockPayment(tx, locked.id);
      args.assertTransition(lockedState(locked, payment));
      return this.completePickupLocked(tx, locked, payment, {
        actor: OrderActor.ADMIN,
        actorAccountId: args.actorAccountId,
        note: args.note,
        now: args.now,
      });
    });
  }

  /** 픽업 완료와 정산 확정. 확인된 결제가 없는 주문(결제 도입 전)은 정산을 확정하지 않는다. */
  private async completePickupLocked(
    tx: Prisma.TransactionClient,
    locked: LockedOrderRow,
    payment: LockedPayment | null,
    by: PickupActor,
  ): Promise<AdminOrderRow> {
    const updated = await tx.order.update({
      where: { id: locked.id },
      data: { status: OrderStatus.PICKED_UP, picked_up_at: by.now },
      include: adminOrderInclude,
    });
    await finalizeSettlementLocked(
      tx,
      locked,
      confirmedPaidAmount(payment),
      by.now,
    );
    await tx.orderStatusHistory.create({
      data: {
        order_id: locked.id,
        from_status: locked.status,
        to_status: OrderStatus.PICKED_UP,
        changed_at: by.now,
        actor_type: by.actor,
        actor_account_id: by.actorAccountId,
        note: by.note,
      },
    });
    const firstItem = await firstItemOf(tx, locked.id);
    await this.outbox.publish(
      tx,
      orderStatusChangedEvent({
        orderId: locked.id,
        orderNumber: updated.order_number,
        buyerAccountId: updated.account_id,
        fromStatus: locked.status,
        toStatus: OrderStatus.PICKED_UP,
        storeId: firstItem?.store_id ?? null,
        storeName: firstItem?.store_name_snapshot ?? null,
        productId: firstItem?.product_id ?? null,
        productName: firstItem?.product_name_snapshot ?? null,
        actorType: by.actor,
        pickupAt: updated.pickup_at,
        occurredAt: by.now,
        actorAccountId: by.actorAccountId,
      }),
    );
    if (by.actorAccountId !== null) {
      await this.auditLogs.recordAudit(tx, {
        actorAccountId: by.actorAccountId,
        // 판매자에게 보인 주문만 매장 id를 붙인다(판매자 감사 로그 노출)
        storeId: locked.submitted_at ? (firstItem?.store_id ?? null) : null,
        targetType: AuditTargetType.ORDER,
        targetId: locked.id,
        action: AuditActionType.STATUS_CHANGE,
        beforeJson: { status: locked.status },
        afterJson: {
          status: OrderStatus.PICKED_UP,
          actorType: by.actor,
          note: by.note,
        },
      });
    }
    return updated;
  }
}
