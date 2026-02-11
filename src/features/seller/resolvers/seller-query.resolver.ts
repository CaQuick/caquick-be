import { BadRequestException, UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard, type JwtUser } from '../../../global/auth';
import { SellerService } from '../seller.service';
import type {
  SellerAuditLogListInput,
  SellerCursorInput,
  SellerDateCursorInput,
  SellerOrderListInput,
  SellerProductListInput,
} from '../types/seller-input.type';
import type {
  SellerAuditLogOutput,
  SellerBannerOutput,
  SellerConversationMessageOutput,
  SellerConversationOutput,
  SellerCursorConnection,
  SellerFaqTopicOutput,
  SellerOrderDetailOutput,
  SellerOrderSummaryOutput,
  SellerProductOutput,
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '../types/seller-output.type';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class SellerQueryResolver {
  constructor(private readonly sellerService: SellerService) {}

  @Query('sellerMyStore')
  sellerMyStore(@CurrentUser() user: JwtUser): Promise<SellerStoreOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerMyStore(accountId);
  }

  @Query('sellerStoreBusinessHours')
  sellerStoreBusinessHours(
    @CurrentUser() user: JwtUser,
  ): Promise<SellerStoreBusinessHourOutput[]> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerStoreBusinessHours(accountId);
  }

  @Query('sellerStoreSpecialClosures')
  sellerStoreSpecialClosures(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreSpecialClosureOutput>> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerStoreSpecialClosures(accountId, input);
  }

  @Query('sellerStoreDailyCapacities')
  sellerStoreDailyCapacities(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerDateCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreDailyCapacityOutput>> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerStoreDailyCapacities(accountId, input);
  }

  @Query('sellerProducts')
  sellerProducts(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerProductListInput,
  ): Promise<SellerCursorConnection<SellerProductOutput>> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerProducts(accountId, input);
  }

  @Query('sellerProduct')
  sellerProduct(
    @CurrentUser() user: JwtUser,
    @Args('productId') productId: string,
  ): Promise<SellerProductOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerProduct(accountId, parseId(productId));
  }

  @Query('sellerOrderList')
  sellerOrderList(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerOrderListInput,
  ): Promise<SellerCursorConnection<SellerOrderSummaryOutput>> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerOrderList(accountId, input);
  }

  @Query('sellerOrder')
  sellerOrder(
    @CurrentUser() user: JwtUser,
    @Args('orderId') orderId: string,
  ): Promise<SellerOrderDetailOutput> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerOrder(accountId, parseId(orderId));
  }

  @Query('sellerConversations')
  sellerConversations(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerConversationOutput>> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerConversations(accountId, input);
  }

  @Query('sellerConversationMessages')
  sellerConversationMessages(
    @CurrentUser() user: JwtUser,
    @Args('conversationId') conversationId: string,
    @Args('input', { nullable: true }) input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerConversationMessageOutput>> {
    const accountId = parseAccountId(user);
    return this.sellerService.sellerConversationMessages(
      accountId,
      parseId(conversationId),
      input,
    );
  }

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

function parseAccountId(user: JwtUser): bigint {
  try {
    return BigInt(user.accountId);
  } catch {
    throw new BadRequestException('Invalid account id.');
  }
}

function parseId(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException('Invalid id.');
  }
}
