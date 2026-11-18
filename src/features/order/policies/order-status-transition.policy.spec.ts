import { HOUR_MS } from '@/common/utils/kst-time';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import {
  autoPickupAt,
  isInNoShowWindow,
  OrderStatusTransitionPolicy,
} from '@/features/order/policies/order-status-transition.policy';
import { OrderActor, OrderStatus } from '@/generated/prisma/client';

const STATUSES = Object.values(OrderStatus);
const ACTORS = Object.values(OrderActor);

const PICKUP_AT = new Date('2026-11-20T05:00:00.000Z');
const IN_NO_SHOW_WINDOW = new Date(PICKUP_AT.getTime() + HOUR_MS);
const AFTER_AUTO_PICKUP = autoPickupAt(PICKUP_AT);

/** 허용 전이 정본(actor:from>to). 이 밖은 전부 거절이다(기본 거절). */
const ALLOWED = new Set([
  'ADMIN:PENDING_PAYMENT>SUBMITTED',
  'BUYER:PENDING_PAYMENT>CANCELED',
  'ADMIN:PENDING_PAYMENT>CANCELED',
  'SYSTEM:PENDING_PAYMENT>CANCELED',
  'SELLER:SUBMITTED>CONFIRMED',
  'BUYER:SUBMITTED>CANCELED',
  'SELLER:SUBMITTED>CANCELED',
  'ADMIN:SUBMITTED>CANCELED',
  'SYSTEM:SUBMITTED>CANCELED',
  'SELLER:CONFIRMED>MADE',
  'SELLER:CONFIRMED>PICKED_UP',
  'SYSTEM:CONFIRMED>PICKED_UP',
  'SELLER:CONFIRMED>NO_SHOW',
  'SELLER:CONFIRMED>CANCELED',
  'ADMIN:CONFIRMED>CANCELED',
  'SELLER:MADE>PICKED_UP',
  'SYSTEM:MADE>PICKED_UP',
  'SELLER:MADE>NO_SHOW',
  'SELLER:MADE>CANCELED',
  'ADMIN:MADE>CANCELED',
]);

function expectedCode(
  actor: OrderActor,
  from: OrderStatus,
  to: OrderStatus,
): string | null {
  if (from === to) return 'ORDER_STATUS_UNCHANGED';
  if (ALLOWED.has(`${actor}:${from}>${to}`)) return null;
  return 'INVALID_ORDER_STATUS_TRANSITION';
}

/** 시각 조건이 있는 전이는 그 조건을 채우는 시각으로 표를 본다(경계는 아래 describe). */
function nowFor(actor: OrderActor, to: OrderStatus): Date {
  return to === OrderStatus.PICKED_UP && actor === OrderActor.SYSTEM
    ? AFTER_AUTO_PICKUP
    : IN_NO_SHOW_WINDOW;
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

  describe('assertTransition 전수(주체 4 × from 7 × to 7)', () => {
    const cases = ACTORS.flatMap((actor) =>
      STATUSES.flatMap((from) =>
        STATUSES.map(
          (to) => [actor, from, to, expectedCode(actor, from, to)] as const,
        ),
      ),
    );

    it('표는 196 조합을 덮고 허용 전이는 20개다(종료 상태에서 나가는 전이는 없다)', () => {
      expect(cases).toHaveLength(4 * 7 * 7);
      expect(cases.filter(([, , , code]) => code === null)).toHaveLength(20);
      for (const terminal of ['PICKED_UP', 'NO_SHOW', 'CANCELED']) {
        expect(
          cases.filter(([, from, , code]) => from === terminal && !code),
        ).toHaveLength(0);
      }
    });

    it.each(cases)('%s: %s → %s = %s', (actor, from, to, code) => {
      const request = {
        actor,
        from,
        to,
        now: nowFor(actor, to),
        pickupAt: PICKUP_AT,
      };
      expect(policy.canTransition(request)).toBe(code === null);
      const run = () => policy.assertTransition(request);
      if (code === null) expect(run).not.toThrow();
      else expect(run).toThrowDomain(code);
    });

    it.each(
      ACTORS.flatMap((actor) => STATUSES.map((s) => [actor, s] as const)),
    )('%s의 %s 취소 허용은 OrderCancelPolicy와 같다', (actor, status) => {
      const allowed = policy.canTransition({
        actor,
        from: status,
        to: OrderStatus.CANCELED,
        now: IN_NO_SHOW_WINDOW,
        pickupAt: PICKUP_AT,
      });
      expect(allowed).toBe(new OrderCancelPolicy().canCancel(actor, status));
    });
  });

  describe('노쇼 구간(pickupAt ≤ now < pickupAt + 24h)', () => {
    const at = (offsetMs: number) => new Date(PICKUP_AT.getTime() + offsetMs);

    it.each([
      ['pickupAt − 1ms', at(-1), false],
      ['pickupAt', at(0), true],
      ['pickupAt + 24h − 1ms', at(24 * HOUR_MS - 1), true],
      ['pickupAt + 24h', at(24 * HOUR_MS), false],
    ])('%s: 허용 %s', (_label, now, allowed) => {
      expect(isInNoShowWindow(PICKUP_AT, now)).toBe(allowed);
      for (const from of [OrderStatus.CONFIRMED, OrderStatus.MADE]) {
        const run = () =>
          policy.assertTransition({
            actor: OrderActor.SELLER,
            from,
            to: OrderStatus.NO_SHOW,
            now,
            pickupAt: PICKUP_AT,
          });
        if (allowed) expect(run).not.toThrow();
        else expect(run).toThrowDomain('NO_SHOW_NOT_ALLOWED');
      }
    });
  });

  describe('자동 픽업 완료(SYSTEM)는 pickupAt + 24h부터', () => {
    it.each([
      [-1, false],
      [0, true],
    ])('pickupAt + 24h %+dms: 허용 %s', (offset, allowed) => {
      const request = {
        actor: OrderActor.SYSTEM,
        from: OrderStatus.MADE,
        to: OrderStatus.PICKED_UP,
        now: new Date(AFTER_AUTO_PICKUP.getTime() + offset),
        pickupAt: PICKUP_AT,
      };
      expect(policy.canTransition(request)).toBe(allowed);
      // 판매자 픽업 완료에는 시각 조건이 없다
      expect(
        policy.canTransition({ ...request, actor: OrderActor.SELLER }),
      ).toBe(true);
    });
  });
});
