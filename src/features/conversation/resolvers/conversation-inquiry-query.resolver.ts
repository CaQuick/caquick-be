import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';
import type { StoreInquiryContextOutput } from '@/features/conversation/types/conversation-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class ConversationInquiryQueryResolver {
  constructor(private readonly inquiryService: ConversationInquiryService) {}

  @Query('storeInquiryContext')
  storeInquiryContext(
    @CurrentUser() user: JwtUser,
    @Args('storeId') storeId: string,
  ): Promise<StoreInquiryContextOutput> {
    const accountId = parseAccountId(user);
    return this.inquiryService.storeInquiryContext(accountId, storeId);
  }
}
