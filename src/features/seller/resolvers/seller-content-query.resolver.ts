import { Inject, UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { SellerAuditLogListInput } from '@/features/seller/dto/inputs/seller-audit-log-list.input';
import { SellerCursorInput } from '@/features/seller/dto/inputs/seller-cursor.input';
import {
  SELLER_AUDIT_SERVICE,
  type ISellerAuditService,
} from '@/features/seller/services/seller-audit.service.interface';
import {
  SELLER_BANNER_SERVICE,
  type ISellerBannerService,
} from '@/features/seller/services/seller-banner.service.interface';
import {
  SELLER_FAQ_SERVICE,
  type ISellerFaqService,
} from '@/features/seller/services/seller-faq.service.interface';
import type {
  SellerAuditLogOutput,
  SellerBannerOutput,
  SellerCursorConnection,
  SellerFaqTopicOutput,
} from '@/features/seller/types/seller-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class SellerContentQueryResolver {
  constructor(
    @Inject(SELLER_FAQ_SERVICE)
    private readonly faqService: ISellerFaqService,
    @Inject(SELLER_BANNER_SERVICE)
    private readonly bannerService: ISellerBannerService,
    @Inject(SELLER_AUDIT_SERVICE)
    private readonly auditService: ISellerAuditService,
  ) {}

  @Query('sellerFaqTopics')
  sellerFaqTopics(
    @CurrentUser() user: JwtUser,
  ): Promise<SellerFaqTopicOutput[]> {
    const accountId = parseAccountId(user);
    return this.faqService.sellerFaqTopics(accountId);
  }

  @Query('sellerBanners')
  sellerBanners(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerBannerOutput>> {
    const accountId = parseAccountId(user);
    return this.bannerService.sellerBanners(accountId, input);
  }

  @Query('sellerAuditLogs')
  sellerAuditLogs(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerAuditLogListInput,
  ): Promise<SellerCursorConnection<SellerAuditLogOutput>> {
    const accountId = parseAccountId(user);
    return this.auditService.sellerAuditLogs(accountId, input);
  }
}
