import { Inject, Injectable } from '@nestjs/common';

import { DAY_MS } from '@/common/utils/kst-time';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { orderStatusChangedEvent } from '@/features/order/events/order-status-changed.event';
import { orderSubmittedEvent } from '@/features/order/events/order-submitted.event';
import {
  adminOrderInclude,
  type AdminOrderRow,
} from '@/features/order/repositories/order.repository';
import { OutboxPublisher } from '@/features/outbox';
import {
  AuditActionType,
  AuditTargetType,
  OrderActor,
  OrderStatus,
  PaymentConfirmSource,
  PaymentStatus,
  type Prisma,
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

/** 접수 뒤 판매자 확정 마감: 확인 + 24시간과 픽업 시각 중 이른 쪽. */
const CONFIRM_WINDOW_MS = DAY_MS;

/** 주문 상태 전이 잠금 단위. 잠금 순서는 order → payment. */
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
    const [locked] = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM \`order\`
      WHERE id = ${args.orderId} AND deleted_at IS NULL
      FOR UPDATE`;
    if (!locked) return null;
    await tx.$queryRaw`SELECT id FROM payment WHERE order_id = ${locked.id} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: locked.id },
      select: { status: true, pickup_at: true, payment: true },
    });
    args.assertConfirmable({
      orderStatus: order.status,
      paymentStatus: order.payment?.status ?? null,
      paymentAmount: order.payment?.amount ?? null,
      pickupAt: order.pickup_at,
    });
    const payment = order.payment!;
    const confirmDeadlineAt = new Date(
      Math.min(
        args.now.getTime() + CONFIRM_WINDOW_MS,
        order.pickup_at.getTime(),
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

    const firstItem = await tx.orderItem.findFirst({
      where: { order_id: locked.id, ...activeWhere },
      orderBy: { id: 'asc' },
      select: {
        store_id: true,
        product_id: true,
        product_name_snapshot: true,
        store_name_snapshot: true,
        quantity: true,
      },
    });
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
        paymentAmount: payment.amount,
        depositedAmount: args.depositedAmount,
        confirmSource: args.source,
        note: args.note,
      },
    });
    return updated;
  }
}
