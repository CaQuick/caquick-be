import { Module } from '@nestjs/common';

import { ConversationRepository } from './repositories/conversation.repository';
import { ConversationDomainService } from './services/conversation-domain.service';

@Module({
  providers: [ConversationRepository, ConversationDomainService],
  exports: [ConversationRepository, ConversationDomainService],
})
export class ConversationModule {}
