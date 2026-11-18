import { assertPaymentConfirmable } from '@/features/order/policies/payment-confirm.policy';
import type { PaymentConfirmState } from '@/features/order/repositories/order-transition.repository';
import {
  OrderStatus,
  PaymentStatus,
  type OrderStatus as OrderStatusType,
} from '@/generated/prisma/client';

const NOW = new Date('2026-09-16T07:00:00.000Z');
const OK: PaymentConfirmState = {
  orderStatus: OrderStatus.PENDING_PAYMENT,
  paymentStatus: PaymentStatus.PENDING,
  paymentAmount: 30_000,
  pickupAt: new Date(NOW.getTime() + 1),
};

describe('assertPaymentConfirmable', () => {
  it('입금 대기·결제 대기·픽업 전·금액 일치면 통과한다', () => {
    expect(() => assertPaymentConfirmable(OK, 30_000, NOW)).not.toThrow();
  });

  // 주문 상태 전수 — 입금 대기 밖은 모두 409
  it.each(
    (Object.values(OrderStatus) as OrderStatusType[]).filter(
      (status) => status !== OrderStatus.PENDING_PAYMENT,
    ),
  )('주문 %s는 PAYMENT_NOT_PENDING이다', (orderStatus) => {
    expect(() =>
      assertPaymentConfirmable({ ...OK, orderStatus }, 30_000, NOW),
    ).toThrowDomain('PAYMENT_NOT_PENDING');
  });

  it.each([PaymentStatus.CONFIRMED, PaymentStatus.CANCELED, null])(
    '결제 %s는 PAYMENT_NOT_PENDING이다',
    (paymentStatus) => {
      expect(() =>
        assertPaymentConfirmable({ ...OK, paymentStatus }, 30_000, NOW),
      ).toThrowDomain('PAYMENT_NOT_PENDING');
    },
  );

  it('상태가 틀리면 픽업·금액보다 먼저 409다', () => {
    expect(() =>
      assertPaymentConfirmable(
        { ...OK, orderStatus: OrderStatus.CANCELED, pickupAt: NOW },
        1,
        NOW,
      ),
    ).toThrowDomain('PAYMENT_NOT_PENDING');
  });

  it('픽업 시각이 지금이거나 지났으면 금액과 무관하게 PAYMENT_PICKUP_PASSED다', () => {
    for (const pickupAt of [NOW, new Date(NOW.getTime() - 1)]) {
      expect(() =>
        assertPaymentConfirmable({ ...OK, pickupAt }, 1, NOW),
      ).toThrowDomain('PAYMENT_PICKUP_PASSED');
    }
  });

  it.each([29_999, 30_001])(
    '입금액 %s(결제 30000)는 DEPOSIT_AMOUNT_MISMATCH다',
    (deposited) => {
      expect(() => assertPaymentConfirmable(OK, deposited, NOW)).toThrowDomain(
        'DEPOSIT_AMOUNT_MISMATCH',
      );
    },
  );
});
