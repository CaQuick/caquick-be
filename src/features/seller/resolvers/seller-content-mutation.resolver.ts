import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerContentService } from '@/features/seller/services/seller-content.service';
import type {
  SellerCreateBannerInput,
  SellerCreateFaqTopicInput,
  SellerUpdateBannerInput,
  SellerUpdateFaqTopicInput,
} from '@/features/seller/types/seller-input.type';
import type {
  SellerBannerOutput,
  SellerFaqTopicOutput,
} from '@/features/seller/types/seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class SellerContentMutationResolver {
  constructor(private readonly contentService: SellerContentService) {}

  @Mutation('sellerCreateFaqTopic')
  sellerCreateFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const accountId = parseAccountId(user);
    return this.contentService.sellerCreateFaqTopic(accountId, input);
  }

  @Mutation('sellerUpdateFaqTopic')
  sellerUpdateFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const accountId = parseAccountId(user);
    return this.contentService.sellerUpdateFaqTopic(accountId, input);
  }

  @Mutation('sellerDeleteFaqTopic')
  sellerDeleteFaqTopic(
    @CurrentUser() user: JwtUser,
    @Args('topicId') topicId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.contentService.sellerDeleteFaqTopic(
      accountId,
      parseId(topicId),
    );
  }

  @Mutation('sellerCreateBanner')
  sellerCreateBanner(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateBannerInput,
  ): Promise<SellerBannerOutput> {
    const accountId = parseAccountId(user);
    return this.contentService.sellerCreateBanner(accountId, input);
  }

  @Mutation('sellerUpdateBanner')
  sellerUpdateBanner(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateBannerInput,
  ): Promise<SellerBannerOutput> {
    const accountId = parseAccountId(user);
    return this.contentService.sellerUpdateBanner(accountId, input);
  }

  @Mutation('sellerDeleteBanner')
  sellerDeleteBanner(
    @CurrentUser() user: JwtUser,
    @Args('bannerId') bannerId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.contentService.sellerDeleteBanner(accountId, parseId(bannerId));
  }
}
