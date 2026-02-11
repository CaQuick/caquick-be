import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
import { SellerService } from '../seller.service';
import type { SellerUpdateOrderStatusInput } from '../types/seller-input.type';
import type { SellerOrderSummaryOutput } from '../types/seller-output.type';

import { parseAccountId } from './seller-resolver.utils';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class SellerOrderMutationResolver {
  constructor(private readonly sellerService: SellerService) {}

  @Mutation('sellerUpdateOrderStatus')
  sellerUpdateOrderStatus(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateOrderStatusInput,
  ): Promise<SellerOrderSummaryOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerUpdateOrderStatus(accountId, input);
  }
}
