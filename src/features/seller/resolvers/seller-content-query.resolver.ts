import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
import { SellerContentService } from '../services/seller-content.service';
import type {
  SellerAuditLogListInput,
  SellerCursorInput,
} from '../types/seller-input.type';
import type {
  SellerAuditLogOutput,
  SellerBannerOutput,
  SellerCursorConnection,
  SellerFaqTopicOutput,
} from '../types/seller-output.type';

import { parseAccountId } from './seller-resolver.utils';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class SellerContentQueryResolver {
  constructor(private readonly contentService: SellerContentService) {}

  @Query('sellerFaqTopics')
  sellerFaqTopics(
    @CurrentUser() user: JwtUser,
  ): Promise<SellerFaqTopicOutput[]> {
    const accountId = parseAccountId(user);
    return this.contentService.sellerFaqTopics(accountId);
  }

  @Query('sellerBanners')
  sellerBanners(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerBannerOutput>> {
    const accountId = parseAccountId(user);
    return this.contentService.sellerBanners(accountId, input);
  }

  @Query('sellerAuditLogs')
  sellerAuditLogs(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerAuditLogListInput,
  ): Promise<SellerCursorConnection<SellerAuditLogOutput>> {
    const accountId = parseAccountId(user);
    return this.contentService.sellerAuditLogs(accountId, input);
  }
}
