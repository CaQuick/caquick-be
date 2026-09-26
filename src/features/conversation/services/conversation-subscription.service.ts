import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { AccountUserRepository } from '@/features/auth';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationBaseService } from '@/features/conversation/services/conversation-base.service';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import { StoreSellerRepository } from '@/features/store';

/** 이벤트 발행은 각 전송 서비스(구매자 전송·판매자 답장)가 담당한다. */
@Injectable()
export class ConversationSubscriptionService extends ConversationBaseService {
  constructor(
    repo: ConversationRepository,
    accounts: AccountUserRepository,
    private readonly events: ConversationEventsService,
    private readonly stores: StoreSellerRepository,
  ) {
    super(repo, accounts);
  }

  async subscribeConversationMessages(
    accountId: bigint,
    conversationIdRaw: string,
  ): Promise<AsyncIterator<unknown>> {
    const conversationId = parseId(conversationIdRaw);
    const conversation = await this.repo.findConversationAccess(conversationId);

    // 존재하지 않는 대화와 권한 없는 대화를 구분하지 않는다(존재 여부 노출 방지).
    // 판매자 여부는 store의 seller_account_id를 대화에서 조인하지 않고 판매자 컨텍스트(계정→매장)로 판정한다.
    const allowed =
      conversation &&
      (conversation.account_id === accountId ||
        (await this.isSellerOfStore(accountId, conversation.store_id)));
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
    const store = await this.stores.findStoreBySellerAccountId(accountId);
    if (!store) {
      throw new DomainException('STORE_NOT_FOUND');
    }
    return this.events.sellerListIterator(store.id.toString());
  }

  private async isSellerOfStore(
    accountId: bigint,
    storeId: bigint,
  ): Promise<boolean> {
    const store = await this.stores.findStoreBySellerAccountId(accountId);
    return store?.id === storeId;
  }
}
