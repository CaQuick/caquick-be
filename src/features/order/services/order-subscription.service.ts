import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { StoreSellerRepository } from '@/features/store';

/** 이벤트 발행은 각 쓰기 서비스(체크아웃·판매자 상태 변경·관리자 취소)가 담당한다. */
@Injectable()
export class OrderSubscriptionService {
  constructor(
    private readonly stores: StoreSellerRepository,
    private readonly events: OrderEventsService,
  ) {}

  async subscribeSellerOrderUpdates(
    accountId: bigint,
  ): Promise<AsyncIterator<unknown>> {
    const store = await this.stores.findStoreBySellerAccountId(accountId);
    if (!store) {
      throw new DomainException('STORE_NOT_FOUND');
    }
    return this.events.sellerOrderIterator(store.id);
  }
}
