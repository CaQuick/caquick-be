import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationBaseService } from '@/features/conversation/services/conversation-base.service';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';

/** 이벤트 발행은 각 전송 서비스(구매자 전송·판매자 답장)가 담당한다. */
@Injectable()
export class ConversationSubscriptionService extends ConversationBaseService {
  constructor(
    repo: ConversationRepository,
    private readonly events: ConversationEventsService,
  ) {
    super(repo);
  }

  async subscribeConversationMessages(
    accountId: bigint,
    conversationIdRaw: string,
  ): Promise<AsyncIterator<unknown>> {
    const conversationId = parseId(conversationIdRaw);
    const conversation = await this.repo.findConversationAccess(conversationId);

    // 존재하지 않는 대화와 권한 없는 대화를 구분하지 않는다(존재 여부 노출 방지)
    const allowed =
      conversation &&
      (conversation.account_id === accountId ||
        conversation.store.seller_account_id === accountId);
    if (!allowed) {
      throw new DomainException('CONVERSATION_NOT_FOUND');
    }

    return this.events.messageAddedIterator(conversationId.toString());
  }

  async subscribeMyConversationUpdates(
    accountId: bigint,
  ): Promise<AsyncIterator<unknown>> {
    await this.requireActiveUser(accountId);
    return this.events.buyerListIterator(accountId.toString());
  }

  async subscribeSellerConversationUpdates(
    accountId: bigint,
  ): Promise<AsyncIterator<unknown>> {
    const store = await this.repo.findStoreBySellerAccount(accountId);
    if (!store) {
      throw new DomainException('STORE_NOT_FOUND');
    }
    return this.events.sellerListIterator(store.id.toString());
  }
}
