import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
import { SellerService } from '../seller.service';
import type { SellerSendConversationMessageInput } from '../types/seller-input.type';
import type { SellerConversationMessageOutput } from '../types/seller-output.type';

import { parseAccountId } from './seller-resolver.utils';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class SellerConversationMutationResolver {
  constructor(private readonly sellerService: SellerService) {}

  @Mutation('sellerSendConversationMessage')
  sellerSendConversationMessage(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerSendConversationMessageInput,
  ): Promise<SellerConversationMessageOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerSendConversationMessage(accountId, input);
  }
}
