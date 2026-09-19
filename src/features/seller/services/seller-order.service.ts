import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { toDate } from '@/common/utils/date-parser';
import { parseId } from '@/common/utils/id-parser';
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
import {
  OrderRepository,
  OrderStatusTransitionPolicy,
  toOrderItemDetail,
  toOrderStatusHistory,
  type OrderItemDetailRow,
  type OrderStatusHistoryRow,
} from '@/features/order';
import type { SellerOrderListInput } from '@/features/seller/dto/inputs/seller-order-list.input';
import type { SellerUpdateOrderStatusInput } from '@/features/seller/dto/inputs/seller-update-order-status.input';
import type {
  SellerOrderDetailOutput,
  SellerOrderSummaryOutput,
} from '@/features/seller/types/seller-output.type';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import { OrderStatus } from '@/generated/prisma/client';

@Injectable()
export class SellerOrderService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly orderRepository: OrderRepository,
    private readonly statusPolicy: OrderStatusTransitionPolicy,
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

    const current = await this.orderRepository.findOrderDetailByStore({
      orderId,
      storeId: ctx.storeId,
    });
    if (!current) throw new DomainException('ORDER_NOT_FOUND');

    this.statusPolicy.assertSellerTransition(current.status, toStatus);

    if (this.statusPolicy.requiresCancellationNote(toStatus)) {
      if (!input.note || input.note.trim().length === 0) {
        throw new DomainException('CANCELLATION_NOTE_REQUIRED');
      }
    }

    const updated = await this.orderRepository.updateOrderStatusBySeller({
      orderId,
      storeId: ctx.storeId,
      actorAccountId: ctx.accountId,
      toStatus,
      note: cleanNullableText(input.note, 500),
      now: new Date(),
      // 잠금 뒤 현재 상태로 같은 규칙을 다시 적용한다(위 사전 검사는 빠른 거절용)
      assertTransition: (from) =>
        this.statusPolicy.assertSellerTransition(from, toStatus),
    });

    if (!updated) throw new DomainException('ORDER_NOT_FOUND');

    return this.toOrderSummaryOutput(updated);
  }

  private toOrderSummaryOutput(row: {
    id: bigint;
    order_number: string;
    status: OrderStatus;
    pickup_at: Date;
    buyer_name: string;
    buyer_phone: string;
    total_price: number;
    created_at: Date;
  }): SellerOrderSummaryOutput {
    return {
      id: row.id.toString(),
      orderNumber: row.order_number,
      status: row.status,
      pickupAt: row.pickup_at,
      buyerName: row.buyer_name,
      buyerPhone: row.buyer_phone,
      totalPrice: row.total_price,
      createdAt: row.created_at,
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
    subtotal_price: number;
    discount_price: number;
    total_price: number;
    submitted_at: Date | null;
    confirmed_at: Date | null;
    made_at: Date | null;
    picked_up_at: Date | null;
    canceled_at: Date | null;
    created_at: Date;
    updated_at: Date;
    status_histories: OrderStatusHistoryRow[];
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
      statusHistories: row.status_histories.map(toOrderStatusHistory),
    };
  }
}
