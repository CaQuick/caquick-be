import { Module } from '@nestjs/common';

import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';

@Module({
  providers: [ConversationRepository],
  exports: [ConversationRepository],
})
export class ConversationModule {}
