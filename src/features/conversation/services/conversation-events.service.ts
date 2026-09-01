import { Inject, Injectable } from '@nestjs/common';
import type { PubSubEngine } from 'graphql-subscriptions';

import { toConversationMessageEvent } from '@/features/conversation/services/conversation-events-mappers.helper';
import type {
  ConversationListUpdateEvent,
  ConversationMessageOutput,
  SellerConversationListUpdateEvent,
} from '@/features/conversation/types/conversation-output.type';
import { PUB_SUB } from '@/global/pubsub';

/**
 * 대화 subscription 이벤트 발행/구독 어댑터.
 * 토픽 문자열은 여기서만 조립한다 — 발행자(구매자 전송·FAQ 자동응답·판매자
 * 답장)와 구독 리졸버가 같은 토픽을 보게 하는 단일 소스.
 */
@Injectable()
export class ConversationEventsService {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSubEngine) {}

  private messageTopic(conversationId: string): string {
    return `conversation.message.${conversationId}`;
  }

  private buyerTopic(accountId: string): string {
    return `conversation.buyer.${accountId}`;
  }

  private sellerTopic(storeId: string): string {
    return `conversation.seller.${storeId}`;
  }

  /** 저장된 메시지들을 대화방 토픽에 순서대로 발행한다. */
  async publishMessagesAdded(
    messages: ConversationMessageOutput[],
  ): Promise<void> {
    for (const message of messages) {
      await this.pubSub.publish(
        this.messageTopic(message.conversationId),
        toConversationMessageEvent(message),
      );
    }
  }

  async publishBuyerListUpdate(
    accountId: string,
    event: ConversationListUpdateEvent,
  ): Promise<void> {
    await this.pubSub.publish(this.buyerTopic(accountId), event);
  }

  async publishSellerListUpdate(
    storeId: string,
    event: SellerConversationListUpdateEvent,
  ): Promise<void> {
    await this.pubSub.publish(this.sellerTopic(storeId), event);
  }

  messageAddedIterator(conversationId: string): AsyncIterator<unknown> {
    return this.pubSub.asyncIterableIterator(this.messageTopic(conversationId));
  }

  buyerListIterator(accountId: string): AsyncIterator<unknown> {
    return this.pubSub.asyncIterableIterator(this.buyerTopic(accountId));
  }

  sellerListIterator(storeId: string): AsyncIterator<unknown> {
    return this.pubSub.asyncIterableIterator(this.sellerTopic(storeId));
  }
}
