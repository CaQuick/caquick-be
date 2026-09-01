import { Module } from '@nestjs/common';

import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationInquiryMutationResolver } from '@/features/conversation/resolvers/conversation-inquiry-mutation.resolver';
import { ConversationInquiryQueryResolver } from '@/features/conversation/resolvers/conversation-inquiry-query.resolver';
import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';

@Module({
  providers: [
    ConversationRepository,
    ConversationInquiryService,
    ConversationInquiryQueryResolver,
    ConversationInquiryMutationResolver,
  ],
  exports: [ConversationRepository],
})
export class ConversationModule {}
