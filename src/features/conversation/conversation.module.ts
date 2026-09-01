import { Module } from '@nestjs/common';

import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationCenterQueryResolver } from '@/features/conversation/resolvers/conversation-center-query.resolver';
import { ConversationInquiryMutationResolver } from '@/features/conversation/resolvers/conversation-inquiry-mutation.resolver';
import { ConversationInquiryQueryResolver } from '@/features/conversation/resolvers/conversation-inquiry-query.resolver';
import { ConversationCenterService } from '@/features/conversation/services/conversation-center.service';
import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';

@Module({
  providers: [
    ConversationRepository,
    ConversationInquiryService,
    ConversationCenterService,
    ConversationInquiryQueryResolver,
    ConversationInquiryMutationResolver,
    ConversationCenterQueryResolver,
  ],
  exports: [ConversationRepository],
})
export class ConversationModule {}
