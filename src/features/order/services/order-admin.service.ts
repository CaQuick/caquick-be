import { Inject, Injectable } from '@nestjs/common';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { toDate } from '@/common/utils/date-parser';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import type { AdminCancelOrderInput } from '@/features/order/dto/inputs/admin-cancel-order.input';
import type { AdminCompleteOrderPickupInput } from '@/features/order/dto/inputs/admin-complete-order-pickup.input';
import type { AdminOrderListInput } from '@/features/order/dto/inputs/admin-order-list.input';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { confirmedPaidAmount } from '@/features/order/repositories/order-settlement-finalizer.helper';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import {
  OrderRepository,
  type AdminOrderDetailRow,
} from '@/features/order/repositories/order.repository';
import {
  toAdminOrderDetailOutput,
  toAdminOrderSummaryOutput,
} from '@/features/order/services/order-admin-mappers.helper';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import type {
  AdminOrderCancelOptionsOutput,
  AdminOrderDetailOutput,
  AdminOrderSummaryOutput,
  AdminStoreInProgressOrderSummaryOutput,
} from '@/features/order/types/order-admin-output.type';
import { OrderActor, OrderStatus } from '@/generated/prisma/client';

/** 취소 규칙은 OrderCancelPolicy가 단일 소스이고, 저장·이력·환불·알림·감사는 OrderTransitionRepository가 한 트랜잭션에서 처리한다. */
@Injectable()
export class AdminOrderService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly orderRepository: OrderRepository,
    private readonly statusPolicy: OrderStatusTransitionPolicy,
    private readonly cancelPolicy: OrderCancelPolicy,
    private readonly transitions: OrderTransitionRepository,
    private readonly events: OrderEventsService,
    private readonly clock: ClockService,
  ) {
    super(accounts, auditLogs);
  }

  async adminOrders(
    accountId: bigint,
    input?: AdminOrderListInput,
  ): Promise<CursorConnection<AdminOrderSummaryOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: parseOptionalId(input?.cursor),
    });
    const filter = {
      keyword: input?.keyword?.trim() || undefined,
      status: input?.status ? this.statusPolicy.parse(input.status) : undefined,
      inProgress: input?.inProgress ?? false,
      storeId: parseOptionalId(input?.storeId) ?? undefined,
      accountId: parseOptionalId(input?.accountId) ?? undefined,
      fromCreatedAt: toDate(input?.fromCreatedAt),
      toCreatedAt: toDate(input?.toCreatedAt),
    };

    const [rows, totalCount] = await Promise.all([
      this.orderRepository.listOrdersForAdmin({ ...filter, ...normalized }),
      this.orderRepository.countOrdersForAdmin(filter),
    ]);
    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminOrderSummaryOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminOrder(
    accountId: bigint,
    orderId: bigint,
  ): Promise<AdminOrderDetailOutput> {
    await this.requireAdminContext(accountId);
    const row = await this.orderRepository.findOrderDetailForAdmin(orderId);
    if (!row) throw new DomainException('ORDER_NOT_FOUND');
    return toAdminOrderDetailOutput(row, this.cancelOptionsOf(row));
  }

  /** 관리자 FE 취소 다이얼로그가 규칙을 복제하지 않도록 지금 상태의 선택지를 내려 준다. */
  private cancelOptionsOf(
    row: AdminOrderDetailRow,
  ): AdminOrderCancelOptionsOutput {
    const reasons = this.cancelPolicy.reasonsFor(OrderActor.ADMIN, row.status);
    return {
      cancelable: reasons.length > 0,
      reasons: [...reasons],
      refundRule:
        reasons.length > 0 ? this.cancelPolicy.refundRule(row.status) : null,
      paidAmount: confirmedPaidAmount(row.payment),
    };
  }

  /** 정지·숨김 전 경고용. 매장 존재는 보지 않는다(없는 매장은 0건). */
  async adminStoreInProgressOrderSummary(
    accountId: bigint,
    storeId: bigint,
  ): Promise<AdminStoreInProgressOrderSummaryOutput> {
    await this.requireAdminContext(accountId);
    const byStatus =
      await this.orderRepository.countInProgressOrdersByStore(storeId);
    return {
      storeId: storeId.toString(),
      totalCount: byStatus.reduce((sum, row) => sum + row.count, 0),
      byStatus,
    };
  }

  async adminCancelOrder(
    accountId: bigint,
    input: AdminCancelOrderInput,
  ): Promise<AdminOrderSummaryOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const updated = await this.transitions.cancel({
      orderId: parseId(input.orderId),
      actor: OrderActor.ADMIN,
      actorAccountId: ctx.accountId,
      scope: { kind: 'any' },
      note: cleanNullableText(input.note, MAX_REASON_LENGTH),
      now: this.clock.now(),
      decide: (state) =>
        this.cancelPolicy.decide(
          {
            actor: OrderActor.ADMIN,
            reason: input.reason,
            fault: input.fault,
            refundAmount: input.refundAmount,
          },
          state,
        ),
    });
    if (!updated) throw new DomainException('ORDER_NOT_FOUND');
    await this.events.publishSellerStatusChanged(updated);
    return toAdminOrderSummaryOutput(updated);
  }

  /**
   * 확정·제작 완료 주문을 픽업 완료로 바꾸고 정산을 확정한다. 숨긴 매장 주문처럼 자동 픽업 완료가 건너뛰는 주문을
   * 관리자가 건별로 닫는 경로라 매장 숨김은 보지 않는다. 판정은 잠금 읽기 결과로 한다.
   */
  async adminCompleteOrderPickup(
    accountId: bigint,
    input: AdminCompleteOrderPickupInput,
  ): Promise<AdminOrderSummaryOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const now = this.clock.now();
    const updated = await this.transitions.completePickupByAdmin({
      orderId: parseId(input.orderId),
      actorAccountId: ctx.accountId,
      note: cleanNullableText(input.note, MAX_REASON_LENGTH),
      now,
      assertTransition: (state) =>
        this.statusPolicy.assertTransition({
          actor: OrderActor.ADMIN,
          from: state.status,
          to: OrderStatus.PICKED_UP,
          now,
          pickupAt: state.pickupAt,
        }),
    });
    if (!updated) throw new DomainException('ORDER_NOT_FOUND');
    await this.events.publishSellerStatusChanged(updated);
    return toAdminOrderSummaryOutput(updated);
  }
}
