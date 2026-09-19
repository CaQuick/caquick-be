import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationCenterQueryResolver } from '@/features/conversation/resolvers/conversation-center-query.resolver';
import { ConversationInquiryMutationResolver } from '@/features/conversation/resolvers/conversation-inquiry-mutation.resolver';
import { ConversationInquiryQueryResolver } from '@/features/conversation/resolvers/conversation-inquiry-query.resolver';
import { SellerConversationMutationResolver } from '@/features/conversation/resolvers/conversation-seller-mutation.resolver';
import { SellerConversationQueryResolver } from '@/features/conversation/resolvers/conversation-seller-query.resolver';
import { ConversationSubscriptionResolver } from '@/features/conversation/resolvers/conversation-subscription.resolver';
import { ConversationCenterService } from '@/features/conversation/services/conversation-center.service';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';
import { SellerConversationService } from '@/features/conversation/services/conversation-seller.service';
import { ConversationSubscriptionService } from '@/features/conversation/services/conversation-subscription.service';
import { StoreModule } from '@/features/store';

@Module({
  // 판매자 컨텍스트·catalog 읽기 포트(StoreModule), 감사 기록(AuditLogModule), 구매자 상태 판정(AuthModule)
  imports: [StoreModule, AuditLogModule, AuthModule],
  providers: [
    ConversationRepository,
    ConversationEventsService,
    ConversationInquiryService,
    ConversationCenterService,
    ConversationSubscriptionService,
    ConversationInquiryQueryResolver,
    ConversationInquiryMutationResolver,
    ConversationCenterQueryResolver,
    ConversationSubscriptionResolver,
    // 판매자 대화(목록·메시지·답장) — 대화 도메인이 소유한다
    SellerConversationService,
    SellerConversationQueryResolver,
    SellerConversationMutationResolver,
  ],
  exports: [ConversationRepository, ConversationEventsService],
})
export class ConversationModule {}
