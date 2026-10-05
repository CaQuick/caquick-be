import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { SellerSendConversationMessageInput } from '@/features/conversation/dto/inputs/seller-send-conversation-message.input';
import { SellerConversationService } from '@/features/conversation/services/conversation-seller.service';
import type {
  SellerConversationMessageOutput,
  SellerConversationOutput,
} from '@/features/conversation/types/conversation-seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class SellerConversationMutationResolver {
  constructor(
    private readonly conversationService: SellerConversationService,
  ) {}

  @Mutation('sellerSendConversationMessage')
  sellerSendConversationMessage(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerSendConversationMessageInput,
  ): Promise<SellerConversationMessageOutput> {
    const accountId = parseAccountId(user);
    return this.conversationService.sellerSendConversationMessage(
      accountId,
      input,
    );
  }

  @Mutation('sellerMarkConversationRead')
  sellerMarkConversationRead(
    @CurrentUser() user: JwtUser,
    @Args('conversationId') conversationId: string,
  ): Promise<SellerConversationOutput> {
    const accountId = parseAccountId(user);
    return this.conversationService.sellerMarkConversationRead(
      accountId,
      conversationId,
    );
  }
}
