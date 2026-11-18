import {
  DEFAULT_GREETING_TEMPLATE,
  GREETING_NICKNAME_PLACEHOLDER,
  GREETING_STORE_NAME_PLACEHOLDER,
} from '@/features/conversation/constants/conversation.constants';
import type {
  ConversationMessageOutput,
  ConversationOrderCardOutput,
  InquiryBusinessHourOutput,
} from '@/features/conversation/types/conversation-output.type';
import type { StoreConversationMessage } from '@/generated/prisma/client';

/** placeholder는 등장 위치·횟수 제한 없이 전부 치환한다. */
export function renderGreeting(
  template: string | null,
  args: { nickname: string; storeName: string },
): string {
  return (template ?? DEFAULT_GREETING_TEMPLATE)
    .replaceAll(GREETING_NICKNAME_PLACEHOLDER, args.nickname)
    .replaceAll(GREETING_STORE_NAME_PLACEHOLDER, args.storeName);
}

/** Prisma Time(@db.Time)은 UTC 기준 Date로 돌아오므로 UTC 게터를 써야 저장값 그대로 나온다. */
export function formatTimeOfDay(date: Date | null): string | null {
  if (!date) return null;
  const h = date.getUTCHours().toString().padStart(2, '0');
  const m = date.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function toInquiryBusinessHour(row: {
  day_of_week: number;
  is_closed: boolean;
  open_time: Date | null;
  close_time: Date | null;
}): InquiryBusinessHourOutput {
  return {
    dayOfWeek: row.day_of_week,
    isClosed: row.is_closed,
    openTime: row.is_closed ? null : formatTimeOfDay(row.open_time),
    closeTime: row.is_closed ? null : formatTimeOfDay(row.close_time),
  };
}

export type ConversationMessageRow = Pick<
  StoreConversationMessage,
  | 'id'
  | 'conversation_id'
  | 'sender_type'
  | 'body_format'
  | 'body_text'
  | 'body_html'
  | 'image_url'
  | 'order_card_order_id'
  | 'order_card_order_number'
  | 'order_card_product_name'
  | 'order_card_thumbnail_url'
  | 'order_card_pickup_at'
  | 'created_at'
>;

export function toOrderCardOutput(
  row: ConversationMessageRow,
): ConversationOrderCardOutput | null {
  if (
    row.order_card_order_id === null ||
    row.order_card_order_number === null ||
    row.order_card_product_name === null ||
    row.order_card_pickup_at === null
  ) {
    return null;
  }
  return {
    orderId: row.order_card_order_id.toString(),
    orderNumber: row.order_card_order_number,
    productName: row.order_card_product_name,
    thumbnailUrl: row.order_card_thumbnail_url,
    pickupAt: row.order_card_pickup_at,
  };
}

export function toConversationMessageOutput(
  row: ConversationMessageRow,
): ConversationMessageOutput {
  return {
    id: row.id.toString(),
    conversationId: row.conversation_id.toString(),
    senderType: row.sender_type,
    bodyFormat: row.body_format,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    imageUrl: row.image_url,
    orderCard: toOrderCardOutput(row),
    createdAt: row.created_at,
  };
}
