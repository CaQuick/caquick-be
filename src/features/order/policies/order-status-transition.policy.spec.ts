import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderStatus } from '@/generated/prisma/client';

const STATUSES = Object.values(OrderStatus);

/** 판매자 전이 허용 목록. 이 밖은 전부 거절이다(기본 거절). */
const ALLOWED = new Set([
  'SUBMITTED>CONFIRMED',
  'CONFIRMED>MADE',
  'MADE>PICKED_UP',
  'SUBMITTED>CANCELED',
  'CONFIRMED>CANCELED',
  'MADE>CANCELED',
]);

function expectedCode(from: OrderStatus, to: OrderStatus): string | null {
  if (from === to) return 'ORDER_STATUS_UNCHANGED';
  if (ALLOWED.has(`${from}>${to}`)) return null;
  return to === 'CANCELED'
    ? 'ORDER_NOT_CANCELLABLE'
    : 'INVALID_ORDER_STATUS_TRANSITION';
}

describe('OrderStatusTransitionPolicy', () => {
  const policy = new OrderStatusTransitionPolicy();

  describe('parse', () => {
    it('Prisma enum 값 전부를 받는다(입금 대기·노쇼 포함)', () => {
      expect(STATUSES).toEqual(
        expect.arrayContaining(['PENDING_PAYMENT', 'NO_SHOW']),
      );
      for (const status of STATUSES) expect(policy.parse(status)).toBe(status);
    });

    it.each(['INVALID', '', 'submitted'])('%p면 400', (raw) => {
      expect(() => policy.parse(raw)).toThrowDomain('INVALID_ORDER_STATUS');
    });
  });

  describe('assertSellerTransition', () => {
    const cases = STATUSES.flatMap((from) =>
      STATUSES.map((to) => [from, to, expectedCode(from, to)] as const),
    );

    it('표는 상태 전 조합(7×7)을 덮고 허용 전이는 6개다', () => {
      expect(cases).toHaveLength(49);
      expect(cases.filter(([, , code]) => code === null)).toHaveLength(6);
    });

    it.each(cases)('%s → %s: %s', (from, to, code) => {
      const run = () => policy.assertSellerTransition(from, to);
      if (code === null) expect(run).not.toThrow();
      else expect(run).toThrowDomain(code);
    });
  });

  describe('requiresCancellationNote', () => {
    it.each(STATUSES)('%s', (to) => {
      expect(policy.requiresCancellationNote(to)).toBe(to === 'CANCELED');
    });
  });
});
