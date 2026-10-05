import { toLastMessagePreview } from '@/features/conversation/services/conversation-center-mappers.helper';
import type { OutboxEventInput } from '@/features/outbox';
import type { ConversationBodyFormat, Prisma } from '@/generated/prisma/client';

/** 구매자 메시지 전송 이벤트(판매자 푸시 원천). 전송 호출 1회당 1건 — 인사말·FAQ 자동응답(STORE)은 대상이 아니다. */
export const CONVERSATION_BUYER_MESSAGE_SENT =
  'conversation.buyer_message_sent';

/** 푸시 본문 한 줄 분량. HTML은 태그를 걷어낸 뒤 자른다. */
export const BUYER_MESSAGE_PREVIEW_MAX_LENGTH = 100;

export interface ConversationBuyerMessageSentPayload {
  conversationId: string;
  storeId: string;
  buyerAccountId: string;
  messageId: string;
  preview: string;
  /** ISO 8601 */
  messageCreatedAt: string;
}

export function toBuyerMessagePreview(message: {
  body_format: ConversationBodyFormat;
  body_text: string | null;
  body_html: string | null;
}): string {
  return (toLastMessagePreview(message) ?? '').slice(
    0,
    BUYER_MESSAGE_PREVIEW_MAX_LENGTH,
  );
}

export function conversationBuyerMessageSentEvent(args: {
  conversationId: bigint;
  storeId: bigint;
  buyerAccountId: bigint;
  message: {
    id: bigint;
    body_format: ConversationBodyFormat;
    body_text: string | null;
    body_html: string | null;
    created_at: Date;
  };
}): OutboxEventInput {
  const payload: ConversationBuyerMessageSentPayload = {
    conversationId: args.conversationId.toString(),
    storeId: args.storeId.toString(),
    buyerAccountId: args.buyerAccountId.toString(),
    messageId: args.message.id.toString(),
    preview: toBuyerMessagePreview(args.message),
    messageCreatedAt: args.message.created_at.toISOString(),
  };
  return {
    aggregateType: 'conversation',
    aggregateId: payload.conversationId,
    eventType: CONVERSATION_BUYER_MESSAGE_SENT,
    payload: { ...payload },
    occurredAt: args.message.created_at,
    actorAccountId: args.buyerAccountId,
  };
}

/** 소비자용 방어적 파싱 — 형태가 어긋난 payload는 던져서 재시도·FAILED로 드러낸다. */
export function parseConversationBuyerMessageSentPayload(
  value: Prisma.JsonValue,
): ConversationBuyerMessageSentPayload {
  const p = value as Partial<
    Record<keyof ConversationBuyerMessageSentPayload, unknown>
  >;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.conversationId !== 'string' ||
    typeof p.storeId !== 'string' ||
    typeof p.buyerAccountId !== 'string' ||
    typeof p.messageId !== 'string' ||
    typeof p.preview !== 'string' ||
    typeof p.messageCreatedAt !== 'string' ||
    Number.isNaN(Date.parse(p.messageCreatedAt))
  ) {
    throw new Error(`${CONVERSATION_BUYER_MESSAGE_SENT} payload 형식 오류`);
  }
  return {
    conversationId: p.conversationId,
    storeId: p.storeId,
    buyerAccountId: p.buyerAccountId,
    messageId: p.messageId,
    preview: p.preview,
    messageCreatedAt: p.messageCreatedAt,
  };
}
