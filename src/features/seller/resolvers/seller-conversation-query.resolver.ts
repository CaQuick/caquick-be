import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
import { SellerService } from '../seller.service';
import type { SellerCursorInput } from '../types/seller-input.type';
import type {
  SellerConversationMessageOutput,
  SellerConversationOutput,
  SellerCursorConnection,
} from '../types/seller-output.type';

import { parseAccountId, parseId } from './seller-resolver.utils';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class SellerConversationQueryResolver {
  constructor(private readonly sellerService: SellerService) {}

  @Query('sellerConversations')
  sellerConversations(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerConversationOutput>> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerConversations(accountId, input);
  }

  @Query('sellerConversationMessages')
  sellerConversationMessages(
    @CurrentUser() user: JwtUser,
    @Args('conversationId') conversationId: string,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerConversationMessageOutput>> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerConversationMessages(
      accountId,
      parseId(conversationId),
      input,
    );
  }
}
