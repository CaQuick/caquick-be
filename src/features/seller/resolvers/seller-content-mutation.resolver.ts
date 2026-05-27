import { Inject, UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { SellerCreateBannerInput } from '@/features/seller/dto/inputs/seller-create-banner.input';
import { SellerCreateFaqTopicInput } from '@/features/seller/dto/inputs/seller-create-faq-topic.input';
import { SellerUpdateBannerInput } from '@/features/seller/dto/inputs/seller-update-banner.input';
import { SellerUpdateFaqTopicInput } from '@/features/seller/dto/inputs/seller-update-faq-topic.input';
import {
  SELLER_BANNER_SERVICE,
  type ISellerBannerService,
} from '@/features/seller/services/seller-banner.service.interface';
import {
  SELLER_FAQ_SERVICE,
  type ISellerFaqService,
} from '@/features/seller/services/seller-faq.service.interface';
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
  constructor(
    @Inject(SELLER_FAQ_SERVICE)
    private readonly faqService: ISellerFaqService,
    @Inject(SELLER_BANNER_SERVICE)
    private readonly bannerService: ISellerBannerService,
  ) {}

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

  @Mutation('sellerCreateBanner')
  sellerCreateBanner(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateBannerInput,
  ): Promise<SellerBannerOutput> {
    const accountId = parseAccountId(user);
    return this.bannerService.sellerCreateBanner(accountId, input);
  }

  @Mutation('sellerUpdateBanner')
  sellerUpdateBanner(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUpdateBannerInput,
  ): Promise<SellerBannerOutput> {
    const accountId = parseAccountId(user);
    return this.bannerService.sellerUpdateBanner(accountId, input);
  }

  @Mutation('sellerDeleteBanner')
  sellerDeleteBanner(
    @CurrentUser() user: JwtUser,
    @Args('bannerId') bannerId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.bannerService.sellerDeleteBanner(accountId, parseId(bannerId));
  }
}
