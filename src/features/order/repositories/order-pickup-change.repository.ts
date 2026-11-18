import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { orderPickupRescheduledEvent } from '@/features/order/events/order-pickup-rescheduled.event';
import { confirmDeadlineFor } from '@/features/order/policies/order-lifecycle.policy';
import {
  isDailyCapacityExceeded,
  type DailyCapacityGuard,
} from '@/features/order/repositories/order-capacity.helper';
import {
  sellerOrderSummaryInclude,
  type SellerOrderRow,
} from '@/features/order/repositories/order.repository';
import { OutboxPublisher } from '@/features/outbox';
import {
  AuditActionType,
  AuditTargetType,
  OrderStatus,
  Prisma,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

export interface ReschedulePickupArgs {
  orderId: bigint;
  storeId: bigint;
  actorAccountId: bigint;
  pickupAt: Date;
  note: string | null;
  now: Date;
  /** 새 픽업일의 capacity 재검사 대상(이 주문 자신의 점유는 빼고 센다) */
  capacityGuard: DailyCapacityGuard;
  /** 잠금 뒤 상태·현재 픽업 시각으로 다시 판정한다. 던지면 롤백되고 예외가 그대로 나간다. */
  assertReschedulable: (state: { status: OrderStatus; pickupAt: Date }) => void;
}

export type ReschedulePickupResult = SellerOrderRow | 'capacity-exceeded';

/** 판매자 픽업 일시 변경. 잠금 순서는 order → order_store_daily_limit. */
@Injectable()
export class OrderPickupChangeRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisher,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /**
   * 판매자에게 보이는 자기 매장 주문만 옮긴다(없으면 null). 새 날짜 capacity는 행을 잠근 뒤 이 주문을 뺀 점유로 다시 센다.
   * 접수 상태면 확정 마감을 새 픽업 기준으로 다시 재고 미리 알림 표시를 지운다. 변경 이력·감사·구매자 알림 이벤트를 같은 tx에 남긴다.
   * READ COMMITTED: 잠금을 기다린 뒤의 점유 재집계가 그사이 커밋된 주문 생성·픽업 변경을 봐야 한다.
   */
  async reschedule(
    args: ReschedulePickupArgs,
  ): Promise<ReschedulePickupResult | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<
          {
            id: bigint;
            status: OrderStatus;
            pickup_at: Date;
            submitted_at: Date;
            confirm_deadline_at: Date | null;
          }[]
        >`
        SELECT o.id, o.status, o.pickup_at, o.submitted_at, o.confirm_deadline_at FROM \`order\` o
        WHERE o.id = ${args.orderId} AND o.deleted_at IS NULL
          AND o.submitted_at IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM order_item i
            WHERE i.order_id = o.id AND i.store_id = ${args.storeId} AND i.deleted_at IS NULL
          )
        FOR UPDATE OF o`;
        if (!locked) return null;
        args.assertReschedulable({
          status: locked.status,
          pickupAt: locked.pickup_at,
        });

        const items = await tx.orderItem.findMany({
          where: {
            order_id: locked.id,
            store_id: args.storeId,
            ...activeWhere,
          },
          orderBy: { id: 'asc' },
          select: {
            product_id: true,
            product_name_snapshot: true,
            store_name_snapshot: true,
            quantity: true,
          },
        });
        const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
        const exceeded = await isDailyCapacityExceeded(
          tx,
          args.capacityGuard,
          quantity,
          { forUpdate: true, excludeOrderId: locked.id },
        );
        if (exceeded) return 'capacity-exceeded';

        // 결제 도입 전 접수는 마감이 없다 — 새로 만들지 않는다
        const resetDeadline =
          locked.status === OrderStatus.SUBMITTED &&
          locked.confirm_deadline_at !== null;
        const updated = await tx.order.update({
          where: { id: locked.id },
          data: {
            pickup_at: args.pickupAt,
            ...(resetDeadline
              ? {
                  confirm_deadline_at: confirmDeadlineFor(
                    locked.submitted_at,
                    args.pickupAt,
                  ),
                  confirm_reminder_sent_at: null,
                }
              : {}),
          },
          include: sellerOrderSummaryInclude(args.storeId),
        });
        await tx.orderPickupChange.create({
          data: {
            order_id: locked.id,
            from_pickup_at: locked.pickup_at,
            to_pickup_at: args.pickupAt,
            changed_by_account_id: args.actorAccountId,
            note: args.note,
            changed_at: args.now,
          },
        });

        const [firstItem] = items;
        await this.outbox.publish(
          tx,
          orderPickupRescheduledEvent({
            orderId: locked.id,
            orderNumber: updated.order_number,
            buyerAccountId: updated.account_id,
            storeId: args.storeId,
            storeName: firstItem?.store_name_snapshot ?? null,
            productId: firstItem?.product_id ?? null,
            productName: firstItem?.product_name_snapshot ?? null,
            fromPickupAt: locked.pickup_at,
            toPickupAt: args.pickupAt,
            occurredAt: args.now,
            actorAccountId: args.actorAccountId,
          }),
        );
        await this.auditLogs.recordAudit(tx, {
          actorAccountId: args.actorAccountId,
          storeId: args.storeId,
          targetType: AuditTargetType.ORDER,
          targetId: locked.id,
          action: AuditActionType.UPDATE,
          beforeJson: { pickupAt: locked.pickup_at.toISOString() },
          afterJson: { pickupAt: args.pickupAt.toISOString(), note: args.note },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
