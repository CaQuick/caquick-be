import { HOUR_MS } from '@/common/utils/kst-time';
import {
  isConfirmReminderDue,
  isConfirmTimedOut,
  isPaymentExpired,
  type OrderLockedState,
} from '@/features/order/policies/order-lifecycle.policy';
import type { OrderStatus } from '@/generated/prisma/client';

const NOW = new Date('2026-11-19T05:00:00.000Z');
const DAY = 24 * HOUR_MS;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

function state(overrides: Partial<OrderLockedState> = {}): OrderLockedState {
  return {
    status: 'PENDING_PAYMENT',
    pickupAt: at(DAY),
    confirmDeadlineAt: null,
    payment: { status: 'PENDING', expires_at: NOW, buyer_claimed_at: null },
    ...overrides,
  };
}

describe('order-lifecycle.policy', () => {
  describe('isPaymentExpired', () => {
    it.each([
      ['기한 정각', state(), true],
      [
        '기한 1ms 전',
        state({
          payment: {
            status: 'PENDING',
            expires_at: at(1),
            buyer_claimed_at: null,
          },
        }),
        false,
      ],
      [
        "'입금했어요'를 누름",
        state({
          payment: {
            status: 'PENDING',
            expires_at: at(-1),
            buyer_claimed_at: at(-HOUR_MS),
          },
        }),
        false,
      ],
      [
        '결제 확인됨',
        state({
          payment: {
            status: 'CONFIRMED',
            expires_at: at(-1),
            buyer_claimed_at: null,
          },
        }),
        false,
      ],
      ['주문이 이미 접수', state({ status: 'SUBMITTED' }), false],
      ['결제 없음(도입 전)', state({ payment: null }), false],
    ])('%s → %s', (_label, s, expected) => {
      expect(isPaymentExpired(s, NOW)).toBe(expected);
    });
  });

  describe('isConfirmTimedOut', () => {
    it.each<[string, OrderStatus, Date | null, boolean]>([
      ['마감 정각', 'SUBMITTED', NOW, true],
      ['마감 1ms 전', 'SUBMITTED', at(1), false],
      ['마감 없음(결제 도입 전)', 'SUBMITTED', null, false],
      ['이미 확정', 'CONFIRMED', at(-1), false],
    ])('%s → %s', (_label, status, deadline, expected) => {
      expect(
        isConfirmTimedOut(state({ status, confirmDeadlineAt: deadline }), NOW),
      ).toBe(expected);
    });
  });

  describe('isConfirmReminderDue(마감 − 2h ≤ now < 마감, 마감 − 2h > 접수)', () => {
    const due = (
      deadline: Date | null,
      submittedAt: Date | null,
      overrides: { status?: OrderStatus; sentAt?: Date | null } = {},
    ) =>
      isConfirmReminderDue(
        {
          status: overrides.status ?? 'SUBMITTED',
          submittedAt,
          confirmDeadlineAt: deadline,
          confirmReminderSentAt: overrides.sentAt ?? null,
        },
        NOW,
      );

    it.each<[string, Date | null, Date | null, boolean]>([
      ['마감 2시간 전 정각', at(2 * HOUR_MS), at(-DAY), true],
      ['마감 2시간 + 1ms 전', at(2 * HOUR_MS + 1), at(-DAY), false],
      ['마감 1ms 전', at(1), at(-DAY), true],
      ['마감 정각', NOW, at(-DAY), false],
      ['마감 − 2h = 접수', at(HOUR_MS), at(-HOUR_MS), false],
      ['마감 − 2h = 접수 + 1ms', at(HOUR_MS + 1), at(-HOUR_MS), true],
      ['마감 없음', null, at(-DAY), false],
      ['접수 시각 없음', at(HOUR_MS), null, false],
    ])('%s → %s', (_label, deadline, submittedAt, expected) => {
      expect(due(deadline, submittedAt)).toBe(expected);
    });

    it('이미 보냈거나 접수 상태가 아니면 보내지 않는다', () => {
      expect(due(at(HOUR_MS), at(-DAY), { sentAt: at(-1) })).toBe(false);
      expect(due(at(HOUR_MS), at(-DAY), { status: 'CONFIRMED' })).toBe(false);
    });
  });
});
