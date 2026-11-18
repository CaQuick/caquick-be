import {
  IN_PROGRESS_ORDER_STATUSES,
  ORDER_STATUS_TRAITS,
} from '@/features/order/constants/order-status-traits';
import { OrderStatus } from '@/generated/prisma/client';

describe('ORDER_STATUS_TRAITS', () => {
  it('Prisma enum 값과 분류 키가 같은 집합이다', () => {
    expect(Object.keys(ORDER_STATUS_TRAITS).sort()).toEqual(
      Object.values(OrderStatus).sort(),
    );
  });

  it.each([
    ['PENDING_PAYMENT', true],
    ['SUBMITTED', true],
    ['CONFIRMED', true],
    ['MADE', true],
    ['PICKED_UP', false],
    ['NO_SHOW', false],
    ['CANCELED', false],
  ] as const)('%s 진행 중 여부는 %s다', (status, inProgress) => {
    expect(ORDER_STATUS_TRAITS[status].inProgress).toBe(inProgress);
  });

  it('진행 중 상태는 흐름 순이다', () => {
    expect(IN_PROGRESS_ORDER_STATUSES).toEqual([
      'PENDING_PAYMENT',
      'SUBMITTED',
      'CONFIRMED',
      'MADE',
    ]);
  });
});
