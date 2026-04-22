import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderDomainService } from '@/features/order/services/order-domain.service';

describe('OrderDomainService', () => {
  const policy = new OrderStatusTransitionPolicy();
  const service = new OrderDomainService(policy);

  it('parseStatus는 policy.parse에 위임한다', () => {
    expect(service.parseStatus('CONFIRMED')).toBe(OrderStatus.CONFIRMED);
  });

  it('assertSellerTransition은 policy에 위임하여 BadRequestException을 전파한다', () => {
    expect(() =>
      service.assertSellerTransition(OrderStatus.SUBMITTED, OrderStatus.MADE),
    ).toThrow(BadRequestException);
  });

  it('requiresCancellationNote는 policy 결과를 그대로 반환한다', () => {
    expect(service.requiresCancellationNote(OrderStatus.CANCELED)).toBe(true);
    expect(service.requiresCancellationNote(OrderStatus.SUBMITTED)).toBe(false);
  });
});
