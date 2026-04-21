import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';

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

    it('알 수 없는 문자열이면 BadRequestException', () => {
      expect(() => policy.parse('INVALID')).toThrow(BadRequestException);
    });
  });

  describe('assertSellerTransition', () => {
    it('from === to면 BadRequestException', () => {
      expect(() =>
        policy.assertSellerTransition(
          OrderStatus.SUBMITTED,
          OrderStatus.SUBMITTED,
        ),
      ).toThrow(BadRequestException);
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
      ).toThrow(BadRequestException);
    });

    it('MADE는 CONFIRMED에서만 가능', () => {
      expect(() =>
        policy.assertSellerTransition(OrderStatus.CONFIRMED, OrderStatus.MADE),
      ).not.toThrow();
      expect(() =>
        policy.assertSellerTransition(OrderStatus.SUBMITTED, OrderStatus.MADE),
      ).toThrow(BadRequestException);
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
      ).toThrow(BadRequestException);
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
      ).toThrow(BadRequestException);
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
