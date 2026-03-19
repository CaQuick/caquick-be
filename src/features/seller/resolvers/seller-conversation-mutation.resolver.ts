import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '../../../global/auth';
import { SellerConversationService } from '../services/seller-conversation.service';
import type { SellerSendConversationMessageInput } from '../types/seller-input.type';
import type { SellerConversationMessageOutput } from '../types/seller-output.type';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
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
}
