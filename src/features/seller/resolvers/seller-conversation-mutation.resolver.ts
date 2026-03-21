import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';
import type { SellerSendConversationMessageInput } from '@/features/seller/types/seller-input.type';
import type { SellerConversationMessageOutput } from '@/features/seller/types/seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

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
