import {
  formatMinutesOfDay,
  kstMinutesOfDay,
  toKstYmd,
} from '@/common/utils/kst-time';
import type { ConversationBuyerMessageSentPayload } from '@/features/conversation';
import type { OrderSubmittedPayload } from '@/features/order';

/** 앱 딥링크 키. */
const SELLER_PUSH_KIND = {
  ORDER_SUBMITTED: 'ORDER_SUBMITTED',
  BUYER_MESSAGE: 'BUYER_MESSAGE',
} as const;

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

export function buildOrderSubmittedPush(
  p: OrderSubmittedPayload,
): SellerPushContent {
  return {
    title: '새 주문',
    body: `${p.productName} ${p.quantity}개 · 픽업 ${formatKstPickupAt(new Date(p.pickupAt))}`,
    data: { kind: SELLER_PUSH_KIND.ORDER_SUBMITTED, orderId: p.orderId },
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
