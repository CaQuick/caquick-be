import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerCreateFaqTopicInput } from '@/features/seller/dto/inputs/seller-create-faq-topic.input';
import { SellerUpdateFaqTopicInput } from '@/features/seller/dto/inputs/seller-update-faq-topic.input';
import { SellerFaqService } from '@/features/seller/services/seller-faq.service';
import type { SellerFaqTopicOutput } from '@/features/seller/types/seller-output.type';
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
export class SellerContentMutationResolver {
  constructor(private readonly faqService: SellerFaqService) {}

  @Mutation('sellerCreateFaqTopic')
  sellerCreateFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const accountId = parseAccountId(user);
    return this.faqService.sellerCreateFaqTopic(accountId, input);
  }

  @Mutation('sellerUpdateFaqTopic')
  sellerUpdateFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const accountId = parseAccountId(user);
    return this.faqService.sellerUpdateFaqTopic(accountId, input);
  }

  @Mutation('sellerDeleteFaqTopic')
  sellerDeleteFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('topicId') topicId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.faqService.sellerDeleteFaqTopic(accountId, parseId(topicId));
  }
}
