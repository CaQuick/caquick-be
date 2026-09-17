import { toLastMessagePreview } from '@/features/conversation/services/conversation-center-mappers.helper';
import type {
  ConversationMessageEvent,
  ConversationMessageOutput,
} from '@/features/conversation/types/conversation-output.type';

/** 날짜는 ISO 문자열 — Redis JSON 직렬화를 거친다. */
export function toConversationMessageEvent(
  message: ConversationMessageOutput,
): ConversationMessageEvent {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderType: message.senderType,
    bodyFormat: message.bodyFormat,
    bodyText: message.bodyText,
    bodyHtml: message.bodyHtml,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toEventPreview(
  message: ConversationMessageOutput,
): string | null {
  return toLastMessagePreview({
    body_format: message.bodyFormat,
    body_text: message.bodyText,
    body_html: message.bodyHtml,
  });
}
