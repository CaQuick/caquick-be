import type { Provider } from '@nestjs/common';

import { BOOKED_QUANTITY_QUERY } from '@/common/ports/booked-quantity.port';
import { OrderBookedRepository } from '@/features/order/repositories/order-booked.repository';
import { BookedQuantityPort } from '@/features/store/repositories/booked-quantity.port';

/**
 * catalog 픽업 판정 spec에 booked 포트(order 구현)를 배선한다 — 앱에서는 OrderModule이 제공하고
 * store 쪽 포트가 ModuleRef로 지연 바인딩한다(순환 회피).
 */
export function bookedQuantityProviders(): Provider[] {
  return [
    BookedQuantityPort,
    { provide: BOOKED_QUANTITY_QUERY, useClass: OrderBookedRepository },
  ];
}
