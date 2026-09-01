import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { ConversationMessagesInput } from '@/features/conversation/dto/inputs/conversation-messages.input';
import { MyConversationsInput } from '@/features/conversation/dto/inputs/my-conversations.input';
import { ConversationCenterService } from '@/features/conversation/services/conversation-center.service';
import type {
  ConversationMessageConnection,
  MyConversationConnection,
} from '@/features/conversation/types/conversation-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class ConversationCenterQueryResolver {
  constructor(private readonly centerService: ConversationCenterService) {}

  @Query('myConversations')
  myConversations(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: MyConversationsInput,
  ): Promise<MyConversationConnection> {
    const accountId = parseAccountId(user);
    return this.centerService.myConversations(accountId, input);
  }

  @Query('conversationMessages')
  conversationMessages(
    @CurrentUser() user: JwtUser,
    @Args('conversationId') conversationId: string,
    @Args('input', { nullable: true }) input?: ConversationMessagesInput,
  ): Promise<ConversationMessageConnection> {
    const accountId = parseAccountId(user);
    return this.centerService.conversationMessages(
      accountId,
      conversationId,
      input,
    );
  }
}
