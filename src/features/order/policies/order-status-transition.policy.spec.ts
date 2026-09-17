import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderStatus } from '@/generated/prisma/client';

describe('OrderStatusTransitionPolicy', () => {
  const policy = new OrderStatusTransitionPolicy();

  describe('parse', () => {
    it.each([
      ['SUBMITTED', OrderStatus.SUBMITTED],
      ['CONFIRMED', OrderStatus.CONFIRMED],
      ['MADE', OrderStatus.MADE],
      ['PICKED_UP', OrderStatus.PICKED_UP],
      ['CANCELED', OrderStatus.CANCELED],
    ])('"%s" → enum %s', (raw, expected) => {
      expect(policy.parse(raw)).toBe(expected);
    });

    it('알 수 없는 문자열이면 400', () => {
      expect(() => policy.parse('INVALID')).toThrowDomain(400);
    });
  });

  describe('assertSellerTransition', () => {
    it('from === to면 400', () => {
      expect(() =>
        policy.assertSellerTransition(
          OrderStatus.SUBMITTED,
          OrderStatus.SUBMITTED,
        ),
      ).toThrowDomain(400);
    });

    it('CONFIRMED는 SUBMITTED에서만 가능', () => {
      expect(() =>
        policy.assertSellerTransition(
          OrderStatus.SUBMITTED,
          OrderStatus.CONFIRMED,
        ),
      ).not.toThrow();
      expect(() =>
        policy.assertSellerTransition(OrderStatus.MADE, OrderStatus.CONFIRMED),
      ).toThrowDomain(400);
    });

    it('MADE는 CONFIRMED에서만 가능', () => {
      expect(() =>
        policy.assertSellerTransition(OrderStatus.CONFIRMED, OrderStatus.MADE),
      ).not.toThrow();
      expect(() =>
        policy.assertSellerTransition(OrderStatus.SUBMITTED, OrderStatus.MADE),
      ).toThrowDomain(400);
    });

    it('PICKED_UP은 MADE에서만 가능', () => {
      expect(() =>
        policy.assertSellerTransition(OrderStatus.MADE, OrderStatus.PICKED_UP),
      ).not.toThrow();
      expect(() =>
        policy.assertSellerTransition(
          OrderStatus.CONFIRMED,
          OrderStatus.PICKED_UP,
        ),
      ).toThrowDomain(400);
    });

    it('CANCELED는 SUBMITTED/CONFIRMED/MADE에서 가능, PICKED_UP에서는 불가', () => {
      expect(() =>
        policy.assertSellerTransition(
          OrderStatus.SUBMITTED,
          OrderStatus.CANCELED,
        ),
      ).not.toThrow();
      expect(() =>
        policy.assertSellerTransition(
          OrderStatus.CONFIRMED,
          OrderStatus.CANCELED,
        ),
      ).not.toThrow();
      expect(() =>
        policy.assertSellerTransition(OrderStatus.MADE, OrderStatus.CANCELED),
      ).not.toThrow();
      expect(() =>
        policy.assertSellerTransition(
          OrderStatus.PICKED_UP,
          OrderStatus.CANCELED,
        ),
      ).toThrowDomain(400);
    });

    // SUBMITTED는 주문 생성 시점의 초기 상태라 어떤 상태에서도 되돌아갈 수 없다 — 가드가 빠지면 역전이가 조용히 통과되므로 모든 from을 전수 검증한다.
    it.each([
      OrderStatus.CONFIRMED,
      OrderStatus.MADE,
      OrderStatus.PICKED_UP,
      OrderStatus.CANCELED,
    ])('SUBMITTED로 되돌리는 역전이는 거부 (from=%s)', (from) => {
      expect(() =>
        policy.assertSellerTransition(from, OrderStatus.SUBMITTED),
      ).toThrowDomain(400);
    });
  });

  describe('requiresCancellationNote', () => {
    it('CANCELED일 때만 true', () => {
      expect(policy.requiresCancellationNote(OrderStatus.CANCELED)).toBe(true);
      expect(policy.requiresCancellationNote(OrderStatus.CONFIRMED)).toBe(
        false,
      );
      expect(policy.requiresCancellationNote(OrderStatus.MADE)).toBe(false);
    });
  });
});
