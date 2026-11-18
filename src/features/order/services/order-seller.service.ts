import { Inject, Injectable } from '@nestjs/common';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { toDate } from '@/common/utils/date-parser';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import type { SellerCancelOrderInput } from '@/features/order/dto/inputs/seller-cancel-order.input';
import type { SellerOrderListInput } from '@/features/order/dto/inputs/seller-order-list.input';
import type { SellerUpdateOrderStatusInput } from '@/features/order/dto/inputs/seller-update-order-status.input';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import {
  OrderRepository,
  type SellerOrderRow,
} from '@/features/order/repositories/order.repository';
import { toSellerOrderUpdateEvent } from '@/features/order/services/order-events-mappers.helper';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import {
  toOrderCancellation,
  toOrderItemDetail,
  toOrderAutoTransitionTimes,
  toOrderListCustomBadge,
  toOrderStatusHistory,
  type OrderItemDetailRow,
  type OrderStatusHistoryRow,
} from '@/features/order/services/order-output-mappers.helper';
import type {
  SellerOrderDetailOutput,
  SellerOrderSummaryOutput,
} from '@/features/order/types/order-seller-output.type';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import {
  OrderActor,
  OrderStatus,
  type PaymentMethod,
  type Refund,
} from '@/generated/prisma/client';

@Injectable()
export class SellerOrderService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly orderRepository: OrderRepository,
    private readonly statusPolicy: OrderStatusTransitionPolicy,
    private readonly cancelPolicy: OrderCancelPolicy,
    private readonly transitions: OrderTransitionRepository,
    private readonly events: OrderEventsService,
    private readonly clock: ClockService,
  ) {
    super(repo, auditLogs);
  }
  async sellerOrderList(
    accountId: bigint,
    input?: SellerOrderListInput,
  ): Promise<CursorConnection<SellerOrderSummaryOutput>> {
    const ctx = await this.requireSellerContext(accountId);

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });

    const filters = {
      storeId: ctx.storeId,
      status: input?.status ? this.statusPolicy.parse(input.status) : undefined,
      buyerAccountId: parseOptionalId(input?.buyerAccountId) ?? undefined,
      fromCreatedAt: toDate(input?.fromCreatedAt),
      toCreatedAt: toDate(input?.toCreatedAt),
      fromPickupAt: toDate(input?.fromPickupAt),
      toPickupAt: toDate(input?.toPickupAt),
      search: input?.search?.trim() || undefined,
    };

    const [rows, totalCount] = await Promise.all([
      this.orderRepository.listOrdersByStore({
        ...filters,
        limit: normalized.limit,
        cursor: normalized.cursor,
      }),
      this.orderRepository.countOrdersByStore(filters),
    ]);

    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toOrderSummaryOutput(row)),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
      totalCount,
    };
  }

  async sellerOrder(
    accountId: bigint,
    orderId: bigint,
  ): Promise<SellerOrderDetailOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const row = await this.orderRepository.findOrderDetailByStore({
      orderId,
      storeId: ctx.storeId,
    });
    if (!row) throw new DomainException('ORDER_NOT_FOUND');
    return this.toOrderDetailOutput(row);
  }

  async sellerUpdateOrderStatus(
    accountId: bigint,
    input: SellerUpdateOrderStatusInput,
  ): Promise<SellerOrderSummaryOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const orderId = parseId(input.orderId);
    const toStatus = this.statusPolicy.parse(input.toStatus);
    // 취소는 사유·사정·환불액이 필요해 sellerCancelOrder로만 한다
    if (toStatus === OrderStatus.CANCELED) {
      throw new DomainException('INVALID_ORDER_STATUS_TRANSITION');
    }

    const current = await this.orderRepository.findOrderDetailByStore({
      orderId,
      storeId: ctx.storeId,
    });
    if (!current) throw new DomainException('ORDER_NOT_FOUND');

    const now = this.clock.now();
    const assertTransition = (from: OrderStatus, pickupAt: Date) =>
      this.statusPolicy.assertTransition({
        actor: OrderActor.SELLER,
        from,
        to: toStatus,
        now,
        pickupAt,
      });
    assertTransition(current.status, current.pickup_at);

    const updated = await this.orderRepository.updateOrderStatusBySeller({
      orderId,
      storeId: ctx.storeId,
      actorAccountId: ctx.accountId,
      toStatus,
      note: cleanNullableText(input.note, 500),
      now,
      // 잠금 뒤 현재 상태로 같은 규칙을 다시 적용한다(위 사전 검사는 빠른 거절용)
      assertTransition,
    });

    if (!updated) throw new DomainException('ORDER_NOT_FOUND');

    await this.events.publishSellerOrderUpdate(
      ctx.storeId,
      toSellerOrderUpdateEvent('STATUS_CHANGED', updated),
    );
    return this.toOrderSummaryOutput(updated);
  }

  /** 접수 단계 거절(전액 환불)과 확정 뒤 취소(사정 선택). 입금 확인 전 주문은 없는 주문과 같다. */
  async sellerCancelOrder(
    accountId: bigint,
    input: SellerCancelOrderInput,
  ): Promise<SellerOrderSummaryOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const updated = await this.transitions.cancel({
      orderId: parseId(input.orderId),
      actor: OrderActor.SELLER,
      actorAccountId: ctx.accountId,
      scope: { kind: 'store', storeId: ctx.storeId },
      note: cleanNullableText(input.note, MAX_REASON_LENGTH),
      now: this.clock.now(),
      decide: (state) =>
        this.cancelPolicy.decide(
          {
            actor: OrderActor.SELLER,
            reason: input.reason,
            fault: input.fault,
            refundAmount: input.refundAmount,
          },
          state,
        ),
    });
    if (!updated) throw new DomainException('ORDER_NOT_FOUND');
    await this.events.publishSellerStatusChanged(updated);
    return this.toOrderSummaryOutput(updated);
  }

  private toOrderSummaryOutput(row: SellerOrderRow): SellerOrderSummaryOutput {
    return {
      id: row.id.toString(),
      orderNumber: row.order_number,
      status: row.status,
      pickupAt: row.pickup_at,
      buyerName: row.buyer_name,
      buyerPhone: row.buyer_phone,
      totalPrice: row.total_price,
      createdAt: row.created_at,
      // 내 매장 첫 품목의 주문 시점 스냅샷 — 상품이 바뀌어도 카드 값은 유지된다
      firstItemName: row.items[0]?.product_name_snapshot ?? null,
      firstItemImageUrl: row.items[0]?.product_thumbnail_url_snapshot ?? null,
      ...toOrderListCustomBadge(row.items[0]),
      confirmDeadlineAt: toOrderAutoTransitionTimes(row).confirmDeadlineAt,
    };
  }

  private toOrderDetailOutput(row: {
    id: bigint;
    order_number: string;
    account_id: bigint;
    status: OrderStatus;
    pickup_at: Date;
    buyer_name: string;
    buyer_phone: string;
    request_note: string | null;
    payment: { method: PaymentMethod } | null;
    subtotal_price: number;
    discount_price: number;
    total_price: number;
    submitted_at: Date | null;
    confirmed_at: Date | null;
    made_at: Date | null;
    picked_up_at: Date | null;
    canceled_at: Date | null;
    confirm_deadline_at: Date | null;
    no_show_at: Date | null;
    created_at: Date;
    updated_at: Date;
    status_histories: OrderStatusHistoryRow[];
    refunds: Refund[];
    items: OrderItemDetailRow[];
  }): SellerOrderDetailOutput {
    return {
      id: row.id.toString(),
      orderNumber: row.order_number,
      accountId: row.account_id.toString(),
      status: row.status,
      pickupAt: row.pickup_at,
      buyerName: row.buyer_name,
      buyerPhone: row.buyer_phone,
      requestNote: row.request_note,
      paymentMethod: row.payment?.method ?? null,
      subtotalPrice: row.subtotal_price,
      discountPrice: row.discount_price,
      totalPrice: row.total_price,
      submittedAt: row.submitted_at,
      confirmedAt: row.confirmed_at,
      madeAt: row.made_at,
      pickedUpAt: row.picked_up_at,
      canceledAt: row.canceled_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: row.items.map(toOrderItemDetail),
      // 입금 대기 이력은 repository가 뺐다 — 접수 이력의 출발 상태도 판매자에게는 '최초'로 보인다
      statusHistories: row.status_histories.map((history) =>
        toOrderStatusHistory(
          history.from_status === OrderStatus.PENDING_PAYMENT
            ? { ...history, from_status: null }
            : history,
        ),
      ),
      cancellation: toOrderCancellation(row),
      ...toOrderAutoTransitionTimes(row),
      canMarkNoShow: this.statusPolicy.canTransition({
        actor: OrderActor.SELLER,
        from: row.status,
        to: OrderStatus.NO_SHOW,
        now: this.clock.now(),
        pickupAt: row.pickup_at,
      }),
    };
  }
}
