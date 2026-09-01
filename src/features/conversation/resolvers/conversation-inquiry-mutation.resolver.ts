import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { SendConversationFaqMessageInput } from '@/features/conversation/dto/inputs/send-conversation-faq-message.input';
import { SendConversationMessageInput } from '@/features/conversation/dto/inputs/send-conversation-message.input';
import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';
import type { ConversationMessagesPayload } from '@/features/conversation/types/conversation-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class ConversationInquiryMutationResolver {
  constructor(private readonly inquiryService: ConversationInquiryService) {}

  @Mutation('sendConversationMessage')
  sendConversationMessage(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SendConversationMessageInput,
  ): Promise<ConversationMessagesPayload> {
    const accountId = parseAccountId(user);
    return this.inquiryService.sendConversationMessage(accountId, input);
  }

  @Mutation('sendConversationFaqMessage')
  sendConversationFaqMessage(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SendConversationFaqMessageInput,
  ): Promise<ConversationMessagesPayload> {
    const accountId = parseAccountId(user);
    return this.inquiryService.sendConversationFaqMessage(accountId, input);
  }
}
