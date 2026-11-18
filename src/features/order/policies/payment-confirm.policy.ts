import { DomainException } from '@/common/errors/error-catalog';
import type { PaymentConfirmState } from '@/features/order/repositories/order-transition.repository';
import { OrderStatus, PaymentStatus } from '@/generated/prisma/client';

/**
 * 입금 확인 가능 판정. 픽업이 지난 주문은 확인하면 곧바로 확정 마감이 지나 접수·취소 알림이 연달아 가므로 막고,
 * 금액이 틀린 입금은 반환 대상으로 돌린다.
 */
export function assertPaymentConfirmable(
  state: PaymentConfirmState,
  depositedAmount: number,
  now: Date,
): void {
  if (
    state.orderStatus !== OrderStatus.PENDING_PAYMENT ||
    state.paymentStatus !== PaymentStatus.PENDING
  ) {
    throw new DomainException('PAYMENT_NOT_PENDING');
  }
  if (state.pickupAt <= now) {
    throw new DomainException('PAYMENT_PICKUP_PASSED');
  }
  if (depositedAmount !== state.paymentAmount) {
    throw new DomainException('DEPOSIT_AMOUNT_MISMATCH');
  }
}
