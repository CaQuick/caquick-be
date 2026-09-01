import { Module } from '@nestjs/common';

import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationCenterQueryResolver } from '@/features/conversation/resolvers/conversation-center-query.resolver';
import { ConversationInquiryMutationResolver } from '@/features/conversation/resolvers/conversation-inquiry-mutation.resolver';
import { ConversationInquiryQueryResolver } from '@/features/conversation/resolvers/conversation-inquiry-query.resolver';
import { ConversationSubscriptionResolver } from '@/features/conversation/resolvers/conversation-subscription.resolver';
import { ConversationCenterService } from '@/features/conversation/services/conversation-center.service';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';
import { ConversationSubscriptionService } from '@/features/conversation/services/conversation-subscription.service';

@Module({
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
  ],
  exports: [ConversationRepository, ConversationEventsService],
})
export class ConversationModule {}
