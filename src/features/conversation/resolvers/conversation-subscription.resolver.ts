import { UseGuards } from '@nestjs/common';
import { Args, Resolver, Subscription } from '@nestjs/graphql';

import { ConversationSubscriptionService } from '@/features/conversation/services/conversation-subscription.service';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

/**
 * 이벤트 payload는 발행 시 이미 GraphQL 출력 형태로 조립돼 있어
 * resolve는 payload를 그대로 통과시킨다.
 */
const passthrough = { resolve: (payload: unknown): unknown => payload };

@Resolver('Subscription')
@UseGuards(JwtAuthGuard)
export class ConversationSubscriptionResolver {
  constructor(
    private readonly subscriptionService: ConversationSubscriptionService,
  ) {}

  @Subscription('conversationMessageAdded', passthrough)
  conversationMessageAdded(
    @CurrentUser() user: JwtUser,
    @Args('conversationId') conversationId: string,
  ): Promise<AsyncIterator<unknown>> {
    const accountId = parseAccountId(user);
    return this.subscriptionService.subscribeConversationMessages(
      accountId,
      conversationId,
    );
  }

  @Subscription('myConversationUpdated', passthrough)
  myConversationUpdated(
    @CurrentUser() user: JwtUser,
  ): Promise<AsyncIterator<unknown>> {
    const accountId = parseAccountId(user);
    return this.subscriptionService.subscribeMyConversationUpdates(accountId);
  }

  @Subscription('sellerConversationUpdated', passthrough)
  sellerConversationUpdated(
    @CurrentUser() user: JwtUser,
  ): Promise<AsyncIterator<unknown>> {
    const accountId = parseAccountId(user);
    return this.subscriptionService.subscribeSellerConversationUpdates(
      accountId,
    );
  }
}
