// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { ConversationModule } from '@/features/conversation/conversation.module';
export { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
// subscription 이벤트 발행/구독 어댑터 — 판매자 답장(seller feature)도 같은 토픽을 쓴다.
export { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
export { toEventPreview } from '@/features/conversation/services/conversation-events-mappers.helper';
