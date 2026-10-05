// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { ConversationModule } from '@/features/conversation/conversation.module';
export { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
// 구매자 메시지 전송 이벤트 계약(outbox). 판매자 푸시 소비자(notification)가 payload 스냅샷만 읽는다.
export {
  CONVERSATION_BUYER_MESSAGE_SENT,
  parseConversationBuyerMessageSentPayload,
} from '@/features/conversation/events/conversation-buyer-message-sent.event';
