import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import {
  BOOKED_QUANTITY_QUERY,
  type IBookedQuantityQuery,
} from '@/common/ports/booked-quantity.port';

/**
 * order가 제공하는 예약 수량 조회의 지연 바인딩. order → store 의존(픽업 재검증)이 이미 있어
 * StoreModule이 OrderModule을 import하면 순환이라, 첫 호출 때 컨테이너 전체(strict: false)에서 토큰을 찾는다.
 * 구현이 없으면 첫 호출이 던진다 — module-wiring spec이 AppModule에서 토큰이 resolve되는지 본다.
 */
@Injectable()
export class BookedQuantityPort implements IBookedQuantityQuery {
  private impl: IBookedQuantityQuery | undefined;

  constructor(private readonly moduleRef: ModuleRef) {}

  sumByStore(
    storeIds: bigint[],
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<Map<bigint, number>> {
    return this.resolve().sumByStore(storeIds, rangeStartUtc, rangeEndUtc);
  }

  sumByKstDate(
    storeId: bigint,
    rangeStartUtc: Date,
    rangeEndUtc: Date,
  ): Promise<Map<string, number>> {
    return this.resolve().sumByKstDate(storeId, rangeStartUtc, rangeEndUtc);
  }

  private resolve(): IBookedQuantityQuery {
    this.impl ??= this.moduleRef.get<IBookedQuantityQuery>(
      BOOKED_QUANTITY_QUERY,
      { strict: false },
    );
    return this.impl;
  }
}
