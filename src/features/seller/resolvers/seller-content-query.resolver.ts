import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { SellerAuditLogListInput } from '@/features/seller/dto/inputs/seller-audit-log-list.input';
import { SellerAuditService } from '@/features/seller/services/seller-audit.service';
import { SellerFaqService } from '@/features/seller/services/seller-faq.service';
import type {
  SellerAuditLogOutput,
  SellerCursorConnection,
  SellerFaqTopicOutput,
} from '@/features/seller/types/seller-output.type';
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
export class SellerContentQueryResolver {
  constructor(
    private readonly faqService: SellerFaqService,
    private readonly auditService: SellerAuditService,
  ) {}

  @Query('sellerFaqTopics')
  sellerFaqTopics(
    @CurrentUser() user: JwtUser,
  ): Promise<SellerFaqTopicOutput[]> {
    const accountId = parseAccountId(user);
    return this.faqService.sellerFaqTopics(accountId);
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
