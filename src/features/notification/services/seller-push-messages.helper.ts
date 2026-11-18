import {
  formatMinutesOfDay,
  kstMinutesOfDay,
  toKstYmd,
} from '@/common/utils/kst-time';
import type { ConversationBuyerMessageSentPayload } from '@/features/conversation';
import type {
  OrderStatusChangedPayload,
  OrderSubmittedPayload,
} from '@/features/order';
import { OrderActor, OrderStatus } from '@/generated/prisma/client';

/** 앱 딥링크 키. */
const SELLER_PUSH_KIND = {
  ORDER_SUBMITTED: 'ORDER_SUBMITTED',
  ORDER_CANCELED: 'ORDER_CANCELED',
  BUYER_MESSAGE: 'BUYER_MESSAGE',
} as const;

/** 판매자 본인이 아닌 취소 주체. 이 밖(판매자 본인·주체를 모르는 옛 이벤트)은 푸시하지 않는다. */
const CANCEL_ACTOR_LABELS: Partial<Record<OrderActor, string>> = {
  [OrderActor.BUYER]: '구매자',
  [OrderActor.ADMIN]: '운영자',
  [OrderActor.SYSTEM]: '자동',
};

/** Android 알림 채널 — 앱이 같은 id로 만든다. */
export const SELLER_PUSH_CHANNEL_ID = 'default';

export interface SellerPushContent {
  title: string;
  body: string;
  data: Record<string, string>;
}

/** `M/d HH:mm`(KST). */
export function formatKstPickupAt(date: Date): string {
  const { month, day } = toKstYmd(date);
  return `${month}/${day} ${formatMinutesOfDay(kstMinutesOfDay(date))}`;
}

/** 확정 마감 2시간 전 미리 알림을 받을 수 없는 주문(접수 시점에 이미 2시간 미만)은 새 주문 푸시에 마감 시각을 싣는다. */
const CONFIRM_REMINDER_LEAD_MS = 2 * 60 * 60_000;

export function buildOrderSubmittedPush(
  p: OrderSubmittedPayload,
  submittedAt: Date,
): SellerPushContent {
  const deadline = p.confirmDeadlineAt ? new Date(p.confirmDeadlineAt) : null;
  const deadlineNote =
    deadline &&
    deadline.getTime() - CONFIRM_REMINDER_LEAD_MS <= submittedAt.getTime()
      ? ` · ${formatMinutesOfDay(kstMinutesOfDay(deadline))}까지 확정`
      : '';
  return {
    title: '새 주문',
    body: `${p.productName} ${p.quantity}개 · 픽업 ${formatKstPickupAt(new Date(p.pickupAt))}${deadlineNote}`,
    data: { kind: SELLER_PUSH_KIND.ORDER_SUBMITTED, orderId: p.orderId },
  };
}

/** 판매자가 모르는 사이 일어난 취소만 알린다. 입금 전 주문은 판매자에게 보인 적이 없어 뺀다. 대상이 아니거나 매장을 모르면 null. */
export function buildOrderCanceledPush(
  p: OrderStatusChangedPayload,
): { storeId: string; content: SellerPushContent } | null {
  const actorLabel = p.actorType ? CANCEL_ACTOR_LABELS[p.actorType] : null;
  if (
    p.toStatus !== OrderStatus.CANCELED ||
    p.fromStatus === OrderStatus.PENDING_PAYMENT ||
    !actorLabel ||
    p.storeId === null
  ) {
    return null;
  }
  const pickup = p.pickupAt
    ? ` · 픽업 ${formatKstPickupAt(new Date(p.pickupAt))}`
    : '';
  return {
    storeId: p.storeId,
    content: {
      title: '주문 취소',
      body: `${p.productName ?? p.orderNumber}${pickup} 주문이 취소됐어요(${actorLabel})`,
      data: { kind: SELLER_PUSH_KIND.ORDER_CANCELED, orderId: p.orderId },
    },
  };
}

export function buildBuyerMessagePush(
  p: ConversationBuyerMessageSentPayload,
): SellerPushContent {
  return {
    title: '새 문의',
    body: p.preview,
    data: {
      kind: SELLER_PUSH_KIND.BUYER_MESSAGE,
      conversationId: p.conversationId,
    },
  };
}
