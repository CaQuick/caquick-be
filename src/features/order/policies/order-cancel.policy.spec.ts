import {
  OrderCancelPolicy,
  type OrderCancelRequest,
} from '@/features/order/policies/order-cancel.policy';
import {
  OrderActor,
  OrderCancelFault,
  OrderCancelReason,
  OrderStatus,
} from '@/generated/prisma/client';

const policy = new OrderCancelPolicy();
const ACTORS = Object.values(OrderActor);
const STATUSES = Object.values(OrderStatus);
const REASONS = Object.values(OrderCancelReason);

const SELLER_REASONS = [
  'DESIGN_NOT_FEASIBLE',
  'OUT_OF_MATERIALS',
  'SCHEDULE_UNAVAILABLE',
  'INAPPROPRIATE_REQUEST',
  'BUYER_REQUEST',
  'OTHER',
];

/** 기대 허용 표(주체:상태 → 사유). 구현과 따로 적어 두고 전 조합을 대조한다. */
const ALLOWED: Record<string, string[]> = {
  'BUYER:PENDING_PAYMENT': ['BUYER_REQUEST'],
  'BUYER:SUBMITTED': ['BUYER_REQUEST'],
  'SELLER:SUBMITTED': SELLER_REASONS,
  'SELLER:CONFIRMED': SELLER_REASONS,
  'SELLER:MADE': SELLER_REASONS,
  'ADMIN:PENDING_PAYMENT': [...SELLER_REASONS, 'PAYMENT_NOT_RECEIVED'],
  'ADMIN:SUBMITTED': SELLER_REASONS,
  'ADMIN:CONFIRMED': SELLER_REASONS,
  'ADMIN:MADE': SELLER_REASONS,
  'SYSTEM:PENDING_PAYMENT': ['PAYMENT_NOT_RECEIVED'],
  'SYSTEM:SUBMITTED': ['CONFIRM_TIMEOUT'],
};

function expectedReasonCode(
  actor: OrderActor,
  status: OrderStatus,
  reason: OrderCancelReason,
): string | null {
  const allowed = ALLOWED[`${actor}:${status}`];
  if (!allowed) return 'ORDER_NOT_CANCELLABLE';
  return allowed.includes(reason) ? null : 'CANCEL_REASON_NOT_ALLOWED';
}

describe('OrderCancelPolicy', () => {
  describe('주체 × 상태 × 사유 전수', () => {
    const cases = ACTORS.flatMap((actor) =>
      STATUSES.flatMap((status) =>
        REASONS.map(
          (reason) =>
            [
              actor,
              status,
              reason,
              expectedReasonCode(actor, status, reason),
            ] as const,
        ),
      ),
    );

    it('표는 4 × 7 × 8 조합을 덮고 허용은 47개다', () => {
      expect(cases).toHaveLength(224);
      expect(cases.filter(([, , , code]) => code === null)).toHaveLength(47);
    });

    it.each(cases)('%s %s %s: %s', (actor, status, reason, code) => {
      const run = () =>
        policy.decide(
          {
            actor,
            reason,
            fault: OrderCancelFault.SELLER,
          },
          { status, paidAmount: 0 },
        );
      if (code === null) expect(run).not.toThrow();
      else expect(run).toThrowDomain(code);
    });

    it.each(ACTORS.flatMap((a) => STATUSES.map((s) => [a, s] as const)))(
      'reasonsFor·canCancel(%s, %s)는 같은 표를 따른다',
      (actor, status) => {
        const expected = ALLOWED[`${actor}:${status}`] ?? [];
        expect([...policy.reasonsFor(actor, status)].sort()).toEqual(
          [...expected].sort(),
        );
        expect(policy.canCancel(actor, status)).toBe(expected.length > 0);
      },
    );
  });

  describe('상태 × 사정 × 환불액', () => {
    const PAID = 30_000;
    const admin = (
      overrides: Partial<OrderCancelRequest>,
    ): OrderCancelRequest => ({
      actor: OrderActor.ADMIN,
      reason: OrderCancelReason.OTHER,
      ...overrides,
    });
    type Expect = { refundAmount: number; fault: string | null } | string;
    const FAULTS = [null, OrderCancelFault.SELLER, OrderCancelFault.BUYER];
    const AMOUNTS = [null, -1, 0, 1.5, PAID, PAID + 1];

    function expected(
      status: OrderStatus,
      fault: OrderCancelFault | null,
      amount: number | null,
    ): Expect {
      if (status === 'PENDING_PAYMENT') return { refundAmount: 0, fault: null };
      if (status === 'SUBMITTED') return { refundAmount: PAID, fault: null };
      if (fault === null) return 'CANCEL_FAULT_REQUIRED';
      if (fault === 'SELLER') return { refundAmount: PAID, fault };
      if (amount === null) return 'REFUND_AMOUNT_REQUIRED';
      if (amount === 0 || amount === PAID)
        return { refundAmount: amount, fault };
      return 'REFUND_AMOUNT_OUT_OF_RANGE';
    }

    const cases = (
      ['PENDING_PAYMENT', 'SUBMITTED', 'CONFIRMED', 'MADE'] as const
    ).flatMap((status) =>
      FAULTS.flatMap((fault) =>
        AMOUNTS.map(
          (amount) =>
            [status, fault, amount, expected(status, fault, amount)] as const,
        ),
      ),
    );

    it('표는 취소 가능 상태 4 × 사정 3 × 금액 6을 덮는다', () => {
      expect(cases).toHaveLength(72);
    });

    it.each(cases)(
      '%s fault=%s R=%s → %j',
      (status, fault, refundAmount, result) => {
        const run = () =>
          policy.decide(admin({ fault, refundAmount }), {
            status,
            paidAmount: PAID,
          });
        if (typeof result === 'string') {
          expect(run).toThrowDomain(result);
        } else {
          expect(run()).toEqual({ reason: 'OTHER', ...result });
        }
      },
    );

    it('범위 오류 메시지는 결제액 상한을 천 단위로 알려 준다', () => {
      expect(() =>
        policy.decide(
          admin({ fault: OrderCancelFault.BUYER, refundAmount: PAID + 1 }),
          { status: OrderStatus.MADE, paidAmount: PAID },
        ),
      ).toThrow('환불 금액은 0원 이상 30,000원 이하로 입력해 주세요.');
    });

    it('확인된 결제가 없는 주문(결제액 0)은 구매자 사정 환불이 0원만 된다', () => {
      const state = { status: OrderStatus.CONFIRMED, paidAmount: 0 };
      expect(
        policy.decide(
          admin({ fault: OrderCancelFault.BUYER, refundAmount: 0 }),
          state,
        ),
      ).toEqual({ reason: 'OTHER', fault: 'BUYER', refundAmount: 0 });
      expect(() =>
        policy.decide(
          admin({ fault: OrderCancelFault.BUYER, refundAmount: 1 }),
          state,
        ),
      ).toThrowDomain('REFUND_AMOUNT_OUT_OF_RANGE');
      expect(
        policy.decide(admin({ fault: OrderCancelFault.SELLER }), state),
      ).toEqual({ reason: 'OTHER', fault: 'SELLER', refundAmount: 0 });
    });

    it('취소할 수 없는 상태는 사유·금액보다 먼저 ORDER_NOT_CANCELLABLE이다', () => {
      expect(() =>
        policy.decide(
          admin({
            reason: OrderCancelReason.CONFIRM_TIMEOUT,
            refundAmount: -1,
          }),
          { status: OrderStatus.PICKED_UP, paidAmount: PAID },
        ),
      ).toThrowDomain('ORDER_NOT_CANCELLABLE');
    });
  });

  describe('refundRule', () => {
    const RULES = {
      PENDING_PAYMENT: 'NO_REFUND',
      SUBMITTED: 'FULL_REFUND',
      CONFIRMED: 'BY_FAULT',
      MADE: 'BY_FAULT',
      PICKED_UP: null,
      NO_SHOW: null,
      CANCELED: null,
    } satisfies Record<OrderStatus, string | null>;

    it.each(Object.entries(RULES))('%s → %s', (status, rule) => {
      expect(policy.refundRule(status as OrderStatus)).toBe(rule);
    });
  });
});
