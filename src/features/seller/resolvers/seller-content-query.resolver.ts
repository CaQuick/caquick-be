import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
import { SellerService } from '../seller.service';
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
  constructor(private readonly sellerService: SellerService) {}

  @Query('sellerFaqTopics')
  sellerFaqTopics(
    @CurrentUser() user: JwtUser,
  ): Promise<SellerFaqTopicOutput[]> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerFaqTopics(accountId);
  }

  @Query('sellerBanners')
  sellerBanners(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerBannerOutput>> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerBanners(accountId, input);
  }

  @Query('sellerAuditLogs')
  sellerAuditLogs(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerAuditLogListInput,
  ): Promise<SellerCursorConnection<SellerAuditLogOutput>> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerAuditLogs(accountId, input);
  }
}
