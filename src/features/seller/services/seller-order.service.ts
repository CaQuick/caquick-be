import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OrderStatusPolicy } from '../../order/policies/order-status.policy';
import { OrderRepository } from '../../order/repositories/order.repository';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '../repositories/seller.repository';
import type {
  SellerOrderListInput,
  SellerUpdateOrderStatusInput,
} from '../types/seller-input.type';
import type {
  SellerCursorConnection,
  SellerOrderDetailOutput,
  SellerOrderSummaryOutput,
} from '../types/seller-output.type';

import { SellerBaseService } from './seller-base.service';

@Injectable()
export class SellerOrderService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    private readonly orderRepository: OrderRepository,
    private readonly orderStatusPolicy: OrderStatusPolicy,
  ) {
    super(repo);
  }
  async sellerOrderList(
    accountId: bigint,
    input?: SellerOrderListInput,
  ): Promise<SellerCursorConnection<SellerOrderSummaryOutput>> {
    const ctx = await this.requireSellerContext(accountId);

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
    });

    const rows = await this.orderRepository.listOrdersByStore({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      status: input?.status
        ? this.orderStatusPolicy.parse(input.status)
        : undefined,
      fromCreatedAt: this.toDate(input?.fromCreatedAt),
      toCreatedAt: this.toDate(input?.toCreatedAt),
      fromPickupAt: this.toDate(input?.fromPickupAt),
      toPickupAt: this.toDate(input?.toPickupAt),
      search: input?.search?.trim() || undefined,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toOrderSummaryOutput(row)),
      nextCursor: paged.nextCursor,
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
    if (!row) throw new NotFoundException('Order not found.');
    return this.toOrderDetailOutput(row);
  }

  async sellerUpdateOrderStatus(
    accountId: bigint,
    input: SellerUpdateOrderStatusInput,
  ): Promise<SellerOrderSummaryOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const orderId = this.parseId(input.orderId);
    const toStatus = this.orderStatusPolicy.parse(input.toStatus);

    const current = await this.orderRepository.findOrderDetailByStore({
      orderId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException('Order not found.');

    this.orderStatusPolicy.assertSellerTransition(current.status, toStatus);

    if (this.orderStatusPolicy.requiresCancellationNote(toStatus)) {
      if (!input.note || input.note.trim().length === 0) {
        throw new BadRequestException('Cancellation note is required.');
      }
    }

    const updated = await this.orderRepository.updateOrderStatusBySeller({
      orderId,
      storeId: ctx.storeId,
      actorAccountId: ctx.accountId,
      toStatus,
      note: this.cleanNullableText(input.note, 500),
      now: new Date(),
    });

    if (!updated) throw new NotFoundException('Order not found.');

    return this.toOrderSummaryOutput(updated);
  }
}
