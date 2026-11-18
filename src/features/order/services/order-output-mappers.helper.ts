import { ORDER_CANCEL_REASON_LABELS } from '@/features/order/constants/order-cancel-reasons';
import {
  maskAccountNumber,
  toBank,
} from '@/features/order/services/order-bank-account.helper';
import type {
  OrderCancellationOutput,
  OrderItemDetailOutput,
  OrderItemFreeEditOutput,
  OrderRefundOutput,
  OrderStatusHistoryOutput,
} from '@/features/order/types/order-output.type';
import {
  OrderCancelReason,
  OrderStatus,
  RefundKind,
  type OrderActor,
  type OrderCancelFault,
  type Refund,
} from '@/generated/prisma/client';

/** 판매자·관리자·구매자 조회 row가 모두 만족하는 구조적 부분집합. */
export interface OrderItemFreeEditRow {
  id: bigint;
  crop_image_url: string;
  description_text: string;
  sort_order: number;
  attachments: { id: bigint; image_url: string; sort_order: number }[];
}

export interface OrderItemDetailRow {
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
  free_edits: OrderItemFreeEditRow[];
}

export interface OrderStatusHistoryRow {
  id: bigint;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_at: Date;
  note: string | null;
  actor_type: OrderActor;
  cancel_reason: OrderCancelReason | null;
  cancel_fault: OrderCancelFault | null;
  refund_amount: number | null;
}

export function toOrderItemDetail(
  item: OrderItemDetailRow,
): OrderItemDetailOutput {
  return {
    id: item.id.toString(),
    storeId: item.store_id.toString(),
    productId: item.product_id.toString(),
    productName: item.product_name_snapshot,
    regularPrice: item.regular_price_snapshot,
    salePrice: item.sale_price_snapshot,
    quantity: item.quantity,
    itemSubtotalPrice: item.item_subtotal_price,
    optionItems: item.option_items.map((opt) => ({
      id: opt.id.toString(),
      groupName: opt.group_name_snapshot,
      optionTitle: opt.option_title_snapshot,
      priceDelta: opt.option_price_delta_snapshot,
    })),
    customTexts: item.custom_texts.map((text) => ({
      id: text.id.toString(),
      tokenKey: text.token_key_snapshot,
      defaultText: text.default_text_snapshot,
      valueText: text.value_text,
      sortOrder: text.sort_order,
    })),
    freeEdits: item.free_edits.map(toOrderItemFreeEdit),
  };
}

export function toOrderItemFreeEdit(
  edit: OrderItemFreeEditRow,
): OrderItemFreeEditOutput {
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

export function toOrderStatusHistory(
  history: OrderStatusHistoryRow,
): OrderStatusHistoryOutput {
  return {
    id: history.id.toString(),
    fromStatus: history.from_status,
    toStatus: history.to_status,
    changedAt: history.changed_at,
    note: history.note,
    actorType: history.actor_type,
    cancelReason: history.cancel_reason,
    cancelFault: history.cancel_fault,
    refundAmount: history.refund_amount,
  };
}

/** 취소된 주문의 취소 이력과 취소 환불. 취소되지 않았거나 취소 이력이 없으면 null. */
export function toOrderCancellation(row: {
  status: OrderStatus;
  canceled_at: Date | null;
  status_histories: OrderStatusHistoryRow[];
  refunds: Pick<Refund, 'kind' | 'status' | 'completed_at'>[];
}): OrderCancellationOutput | null {
  if (row.status !== OrderStatus.CANCELED) return null;
  const history = row.status_histories.find(
    (h) => h.to_status === OrderStatus.CANCELED,
  );
  if (!history) return null;
  // 도입 전 취소는 마이그레이션이 OTHER로 채웠다
  const reason = history.cancel_reason ?? OrderCancelReason.OTHER;
  const refund = row.refunds.find((r) => r.kind === RefundKind.CANCEL);
  return {
    actorType: history.actor_type,
    reason,
    reasonLabel: ORDER_CANCEL_REASON_LABELS[reason],
    note: history.note,
    fault: history.cancel_fault,
    refundAmount: history.refund_amount ?? 0,
    refundStatus: refund?.status ?? null,
    refundCompletedAt: refund?.completed_at ?? null,
    canceledAt: row.canceled_at ?? history.changed_at,
  };
}

export function toOrderRefund(row: Refund): OrderRefundOutput {
  return {
    id: row.id.toString(),
    kind: row.kind,
    amount: row.amount,
    status: row.status,
    bank: row.bank_code ? toBank(row.bank_code) : null,
    accountHolder: row.account_holder,
    accountNumberMasked: row.account_number_last4
      ? maskAccountNumber(row.account_number_last4)
      : null,
    requestedAt: row.requested_at,
    accountSubmittedAt: row.account_submitted_at,
    completedAt: row.completed_at,
  };
}
