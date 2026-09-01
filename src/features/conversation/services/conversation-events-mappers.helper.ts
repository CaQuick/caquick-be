import { toLastMessagePreview } from '@/features/conversation/services/conversation-center-mappers.helper';
import type {
  ConversationMessageEvent,
  ConversationMessageOutput,
} from '@/features/conversation/types/conversation-output.type';

/** DI-free 순수 함수만 둔다 — subscription 이벤트 payload 변환. */

/** 메시지 출력 → 이벤트 payload(날짜는 ISO 문자열). */
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

/** 메시지 출력 → 목록 이벤트용 미리보기 텍스트. */
export function toEventPreview(
  message: ConversationMessageOutput,
): string | null {
  return toLastMessagePreview({
    body_format: message.bodyFormat,
    body_text: message.bodyText,
    body_html: message.bodyHtml,
  });
}
