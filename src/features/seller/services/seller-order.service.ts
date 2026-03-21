import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

import { parseId } from '../../../common/utils/id-parser';
import { OrderDomainService, OrderRepository } from '../../order';
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

interface OrderFreeEditRow {
  id: bigint;
  crop_image_url: string;
  description_text: string;
  sort_order: number;
  attachments: { id: bigint; image_url: string; sort_order: number }[];
}

interface OrderItemRow {
  id: bigint;
  store_id: bigint;
  product_id: bigint;
  product_name_snapshot: string;
  regular_price_snapshot: number;
  sale_price_snapshot: number | null;
  quantity: number;
  item_subtotal_price: number;
  option_items: {
    id: bigint;
    group_name_snapshot: string;
    option_title_snapshot: string;
    option_price_delta_snapshot: number;
  }[];
  custom_texts: {
    id: bigint;
    token_key_snapshot: string;
    default_text_snapshot: string;
    value_text: string;
    sort_order: number;
  }[];
  free_edits: OrderFreeEditRow[];
}

@Injectable()
export class SellerOrderService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    private readonly orderRepository: OrderRepository,
    private readonly orderDomainService: OrderDomainService,
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
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const rows = await this.orderRepository.listOrdersByStore({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      status: input?.status
        ? this.orderDomainService.parseStatus(input.status)
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
    const orderId = parseId(input.orderId);
    const toStatus = this.orderDomainService.parseStatus(input.toStatus);

    const current = await this.orderRepository.findOrderDetailByStore({
      orderId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException('Order not found.');

    this.orderDomainService.assertSellerTransition(current.status, toStatus);

    if (this.orderDomainService.requiresCancellationNote(toStatus)) {
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
    status_histories: {
      id: bigint;
      from_status: OrderStatus | null;
      to_status: OrderStatus;
      changed_at: Date;
      note: string | null;
    }[];
    items: OrderItemRow[];
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
      items: row.items.map((item) => this.toOrderItemOutput(item)),
      statusHistories: row.status_histories.map((history) => ({
        id: history.id.toString(),
        fromStatus: history.from_status,
        toStatus: history.to_status,
        changedAt: history.changed_at,
        note: history.note,
      })),
    };
  }

  private toOrderItemOutput(item: OrderItemRow) {
    return {
      id: item.id.toString(),
      storeId: item.store_id.toString(),
      productId: item.product_id.toString(),
      productNameSnapshot: item.product_name_snapshot,
      regularPriceSnapshot: item.regular_price_snapshot,
      salePriceSnapshot: item.sale_price_snapshot,
      quantity: item.quantity,
      itemSubtotalPrice: item.item_subtotal_price,
      optionItems: item.option_items.map((opt) => ({
        id: opt.id.toString(),
        groupNameSnapshot: opt.group_name_snapshot,
        optionTitleSnapshot: opt.option_title_snapshot,
        optionPriceDeltaSnapshot: opt.option_price_delta_snapshot,
      })),
      customTexts: item.custom_texts.map((text) => ({
        id: text.id.toString(),
        tokenKeySnapshot: text.token_key_snapshot,
        defaultTextSnapshot: text.default_text_snapshot,
        valueText: text.value_text,
        sortOrder: text.sort_order,
      })),
      freeEdits: item.free_edits.map((edit) => this.toFreeEditOutput(edit)),
    };
  }

  private toFreeEditOutput(edit: OrderFreeEditRow) {
    return {
      id: edit.id.toString(),
      cropImageUrl: edit.crop_image_url,
      descriptionText: edit.description_text,
      sortOrder: edit.sort_order,
      attachments: edit.attachments.map((a) => ({
        id: a.id.toString(),
        imageUrl: a.image_url,
        sortOrder: a.sort_order,
      })),
    };
  }
}
