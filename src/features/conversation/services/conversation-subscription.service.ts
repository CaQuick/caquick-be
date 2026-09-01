import { Injectable, NotFoundException } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { CONVERSATION_ERRORS } from '@/features/conversation/constants/conversation-error-messages';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationBaseService } from '@/features/conversation/services/conversation-base.service';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';

/**
 * subscription 구독 진입점 — 구독 권한 검증 후 토픽 iterator를 돌려준다.
 * 이벤트 발행은 각 전송 서비스(구매자 전송·판매자 답장)가 담당한다.
 */
@Injectable()
export class ConversationSubscriptionService extends ConversationBaseService {
  constructor(
    repo: ConversationRepository,
    private readonly events: ConversationEventsService,
  ) {
    super(repo);
  }

  /** 대화방 메시지 구독 — 대화 소유 구매자 또는 해당 매장 판매자만. */
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
      throw new NotFoundException(CONVERSATION_ERRORS.CONVERSATION_NOT_FOUND);
    }

    return this.events.messageAddedIterator(conversationId.toString());
  }

  /** 구매자 대화 목록/배지 갱신 구독. */
  async subscribeMyConversationUpdates(
    accountId: bigint,
  ): Promise<AsyncIterator<unknown>> {
    await this.requireActiveUser(accountId);
    return this.events.buyerListIterator(accountId.toString());
  }

  /** 판매자 대화 목록 갱신 구독. */
  async subscribeSellerConversationUpdates(
    accountId: bigint,
  ): Promise<AsyncIterator<unknown>> {
    const store = await this.repo.findStoreBySellerAccount(accountId);
    if (!store) {
      throw new NotFoundException(CONVERSATION_ERRORS.STORE_NOT_FOUND);
    }
    return this.events.sellerListIterator(store.id.toString());
  }
}
