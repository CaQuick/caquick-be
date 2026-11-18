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
