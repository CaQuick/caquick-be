import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
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

@Resolver('Query')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
export class SellerConversationQueryResolver {
  constructor(
    private readonly conversationService: SellerConversationService,
  ) {}

  @Query('sellerConversations')
  sellerConversations(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: CursorInput,
  ): Promise<CursorConnection<SellerConversationOutput>> {
    const accountId = parseAccountId(user);
    return this.conversationService.sellerConversations(accountId, input);
  }

  @Query('sellerConversationMessages')
  sellerConversationMessages(
    @CurrentUser() user: JwtUser,
    @Args('conversationId') conversationId: string,
    @Args('input', { nullable: true }) input?: CursorInput,
  ): Promise<CursorConnection<SellerConversationMessageOutput>> {
    const accountId = parseAccountId(user);
    return this.conversationService.sellerConversationMessages(
      accountId,
      parseId(conversationId),
      input,
    );
  }
}
