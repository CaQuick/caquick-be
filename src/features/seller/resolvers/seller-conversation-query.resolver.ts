import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';
import type { SellerCursorInput } from '@/features/seller/types/seller-input.type';
import type {
  SellerConversationMessageOutput,
  SellerConversationOutput,
  SellerCursorConnection,
} from '@/features/seller/types/seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class SellerConversationQueryResolver {
  constructor(
    private readonly conversationService: SellerConversationService,
  ) {}

  @Query('sellerConversations')
  sellerConversations(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerConversationOutput>> {
    const accountId = parseAccountId(user);
    return this.conversationService.sellerConversations(accountId, input);
  }

  @Query('sellerConversationMessages')
  sellerConversationMessages(
    @CurrentUser() user: JwtUser,
    @Args('conversationId') conversationId: string,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerConversationMessageOutput>> {
    const accountId = parseAccountId(user);
    return this.conversationService.sellerConversationMessages(
      accountId,
      parseId(conversationId),
      input,
    );
  }
}
