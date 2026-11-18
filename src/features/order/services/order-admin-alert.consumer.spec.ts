import type { ConfigService } from '@nestjs/config';

import { ClockService } from '@/common/providers/clock.service';
import type { AdminWebConfig } from '@/config/admin-web.config';
import type { AlertingConfig } from '@/config/alerting.config';
import { ORDER_PAYMENT_PENDING } from '@/features/order/events/order-payment-pending.event';
import { PAYMENT_DEPOSIT_CLAIMED } from '@/features/order/events/payment-deposit-claimed.event';
import { REFUND_ACCOUNT_SUBMITTED } from '@/features/order/events/refund-account-submitted.event';
import { REFUND_REQUESTED } from '@/features/order/events/refund-requested.event';
import { SETTLEMENT_CREATED } from '@/features/order/events/settlement-created.event';
import { OrderAdminAlertConsumer } from '@/features/order/services/order-admin-alert.consumer';
import type { OutboxEvent } from '@/features/outbox';
import { AlertService } from '@/global/alerting';
import type { CustomLoggerService } from '@/global/logger/custom-logger.service';

const PENDING = {
  orderId: '42',
  orderNumber: 'ORD-20260916-ABC234',
  amount: 56000,
  depositorName: '차차맘',
  // 9/16 17:00 KST
  expiresAt: '2026-09-16T08:00:00.000Z',
};
const CLAIMED = {
  orderId: '43',
  orderNumber: 'ORD-20260916-XYZ789',
  amount: 1234567,
  depositorName: '홍길동',
};
const REFUND = {
  refundId: '9',
  orderId: '42',
  orderNumber: 'ORD-20260916-ABC234',
  buyerAccountId: '3',
  kind: 'CANCEL',
  amount: 30000,
  storeId: '2',
  storeName: '케이크샵',
  productId: '5',
  productName: '레터링 케이크',
};

const SETTLED = {
  settlementId: '5',
  storeId: '9',
  storeName: '해즈 케이크',
  periodStart: '2026-11-09',
  periodEnd: '2026-11-15',
  orderCount: 3,
  settlementBaseAmount: 90_000,
  commissionAmount: 4_995,
  payoutAmount: 85_005,
};

function event(
  eventType: string,
  payload: OutboxEvent['payload'],
  eventId = 'e-1',
): OutboxEvent {
  return {
    id: 1n,
    eventId,
    aggregateType: 'order',
    aggregateId: '42',
    eventType,
    payload,
    occurredAt: new Date('2026-09-16T07:00:00.000Z'),
    actorAccountId: null,
    clientIp: null,
    userAgent: null,
    attempts: 0,
  };
}

// 관리자 처리 대기 알림 — 이벤트별 key·문구·딥링크, 재전달은 억제 창 안에서만 1회, 형식 오류는 던진다.
describe('OrderAdminAlertConsumer', () => {
  let nowMs = 0;
  const transport = jest.fn().mockResolvedValue(true);

  function build(adminWeb: AdminWebConfig) {
    const clock = new ClockService();
    jest.spyOn(clock, 'nowMs').mockImplementation(() => nowMs);
    const alerting: AlertingConfig = {
      discordWebhookUrl: 'https://discord.test/hook',
      dedupeWindowMs: 5 * 60_000,
    };
    const config = {
      getOrThrow: (key: string) => (key === 'adminWeb' ? adminWeb : alerting),
    } as unknown as ConfigService;
    const alerts = new AlertService(
      config,
      clock,
      { warn: jest.fn(), log: jest.fn() } as unknown as CustomLoggerService,
      transport,
    );
    return new OrderAdminAlertConsumer(alerts, config);
  }

  beforeEach(() => {
    nowMs = 1_000_000;
    transport.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('새 입금 대기: info, 주문별 key, 금액·입금자명·입금 기한(KST)·처리 화면 링크', async () => {
    const consumer = build({ baseUrl: 'https://admin.caquick.com' });

    await consumer.handle(event(ORDER_PAYMENT_PENDING, PENDING));

    expect(transport).toHaveBeenCalledWith(
      'https://discord.test/hook',
      {
        level: 'info',
        title: '새 입금 대기',
        key: 'deposit-pending:42',
        detail: [
          '주문 ORD-20260916-ABC234',
          '56,000원 · 입금자명 차차맘',
          '입금 기한 9/16 17:00',
          'https://admin.caquick.com/tasks/deposits?orderId=42',
        ].join('\n'),
      },
      expect.any(Object),
    );
  });

  it("'입금했어요': info, 주문별 key, 금액·입금자명·처리 화면 링크", async () => {
    const consumer = build({ baseUrl: 'https://caquick.com/admin' });

    await consumer.handle(event(PAYMENT_DEPOSIT_CLAIMED, CLAIMED));

    expect(transport).toHaveBeenCalledWith(
      expect.any(String),
      {
        level: 'info',
        title: "입금 확인 요청('입금했어요')",
        key: 'deposit-claim:43',
        detail: [
          '주문 ORD-20260916-XYZ789',
          '1,234,567원 · 입금자명 홍길동',
          'https://caquick.com/admin/tasks/deposits?orderId=43',
        ].join('\n'),
      },
      expect.any(Object),
    );
  });

  it('관리자 웹 주소가 없으면 링크 없이 보낸다', async () => {
    const consumer = build({ baseUrl: null });

    await consumer.handle(event(PAYMENT_DEPOSIT_CLAIMED, CLAIMED));

    const [, message] = transport.mock.calls[0] as [string, { detail: string }];
    expect(message.detail).toBe(
      ['주문 ORD-20260916-XYZ789', '1,234,567원 · 입금자명 홍길동'].join('\n'),
    );
  });

  it('같은 이벤트 재전달은 억제 창 안에서 한 번만 보내고, 다른 주문은 따로 보낸다', async () => {
    const consumer = build({ baseUrl: null });

    await consumer.handle(event(ORDER_PAYMENT_PENDING, PENDING));
    await consumer.handle(event(ORDER_PAYMENT_PENDING, PENDING));
    // 같은 주문의 '입금했어요'는 다른 일이라 따로 간다
    await consumer.handle(
      event(PAYMENT_DEPOSIT_CLAIMED, { ...CLAIMED, orderId: '42' }),
    );
    await consumer.handle(
      event(ORDER_PAYMENT_PENDING, { ...PENDING, orderId: '44' }),
    );

    expect(
      transport.mock.calls.map(([, m]) => (m as { key: string }).key),
    ).toEqual(['deposit-pending:42', 'deposit-claim:42', 'deposit-pending:44']);
  });

  it('주간 정산 생성: info, 주 단위 key, 기간·처리 화면 링크(periodStart)', async () => {
    const consumer = build({ baseUrl: 'https://admin.caquick.com' });

    await consumer.handle(event(SETTLEMENT_CREATED, SETTLED));

    expect(transport).toHaveBeenCalledWith(
      expect.any(String),
      {
        level: 'info',
        title: '주간 정산 생성',
        key: 'settlement-week:2026-11-09',
        detail: [
          '2026-11-09 ~ 2026-11-15 정산이 생성됐어요. 매장별 정산을 확인하고 송금해 주세요.',
          'https://admin.caquick.com/tasks/settlements?periodStart=2026-11-09',
        ].join('\n'),
      },
      expect.any(Object),
    );
  });

  it('같은 주의 매장별 정산 이벤트는 억제 창 안에서 한 번만 보내고, 다른 주는 따로 보낸다', async () => {
    const consumer = build({ baseUrl: null });

    await consumer.handle(event(SETTLEMENT_CREATED, SETTLED));
    await consumer.handle(
      event(SETTLEMENT_CREATED, {
        ...SETTLED,
        settlementId: '6',
        storeId: '10',
      }),
    );
    await consumer.handle(
      event(SETTLEMENT_CREATED, {
        ...SETTLED,
        settlementId: '7',
        periodStart: '2026-11-16',
        periodEnd: '2026-11-22',
      }),
    );

    expect(
      transport.mock.calls.map(([, m]) => (m as { key: string }).key),
    ).toEqual(['settlement-week:2026-11-09', 'settlement-week:2026-11-16']);
  });

  it.each([
    [
      '취소와 함께 계좌 입력',
      REFUND_REQUESTED,
      { ...REFUND, accountSubmitted: true },
    ],
    ['나중에 계좌 입력', REFUND_ACCOUNT_SUBMITTED, REFUND],
  ])(
    '환불 송금 대기(%s): info, 환불별 key, 금액·종류·처리 화면 링크(계좌번호 없음)',
    async (_label, type, payload) => {
      const consumer = build({ baseUrl: 'https://admin.caquick.com' });

      await consumer.handle(event(type, payload));

      expect(transport).toHaveBeenCalledWith(
        expect.any(String),
        {
          level: 'info',
          title: '환불 송금 대기',
          key: 'refund-ready:9',
          detail: [
            '주문 ORD-20260916-ABC234',
            '30,000원 · 취소 환불',
            'https://admin.caquick.com/tasks/refunds?refundId=9',
          ].join('\n'),
        },
        expect.any(Object),
      );
    },
  );

  it('계좌가 없는 환불 생성은 관리자에게 보내지 않는다(구매자 계좌 요청 알림만 간다)', async () => {
    const consumer = build({ baseUrl: null });

    await consumer.handle(event(REFUND_REQUESTED, REFUND));
    await consumer.handle(
      event(REFUND_REQUESTED, { ...REFUND, accountSubmitted: false }),
    );

    expect(transport).not.toHaveBeenCalled();
  });

  it('같은 환불의 계좌 덮어쓰기는 억제 창 안에서 한 번만, 입금 반환은 종류를 다르게 적는다', async () => {
    const consumer = build({ baseUrl: null });

    await consumer.handle(event(REFUND_ACCOUNT_SUBMITTED, REFUND));
    await consumer.handle(event(REFUND_ACCOUNT_SUBMITTED, REFUND));
    await consumer.handle(
      event(REFUND_ACCOUNT_SUBMITTED, {
        ...REFUND,
        refundId: '10',
        kind: 'DEPOSIT_RETURN',
      }),
    );

    const messages = transport.mock.calls.map(
      ([, m]) => m as { key: string; detail: string },
    );
    expect(messages.map((m) => m.key)).toEqual([
      'refund-ready:9',
      'refund-ready:10',
    ]);
    expect(messages[1].detail).toBe(
      ['주문 ORD-20260916-ABC234', '30,000원 · 입금 반환'].join('\n'),
    );
  });

  it.each([
    [REFUND_REQUESTED, { ...REFUND, kind: 'CHARGEBACK' }],
    [REFUND_ACCOUNT_SUBMITTED, { ...REFUND, amount: '30000' }],
    [SETTLEMENT_CREATED, { ...SETTLED, periodStart: 20261109 }],
    [ORDER_PAYMENT_PENDING, { ...PENDING, amount: '56000' }],
    [ORDER_PAYMENT_PENDING, { ...PENDING, expiresAt: 'not-a-date' }],
    [PAYMENT_DEPOSIT_CLAIMED, { ...CLAIMED, orderId: 43 }],
    [PAYMENT_DEPOSIT_CLAIMED, null],
  ])(
    '반증: %s의 형식이 어긋난 payload는 던진다(재시도·DLQ로 드러난다)',
    async (type, payload) => {
      const consumer = build({ baseUrl: null });
      await expect(
        consumer.handle(event(type, payload as OutboxEvent['payload'])),
      ).rejects.toThrow('payload 형식 오류');
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it('반증: 구독하지 않은 이벤트는 던진다', async () => {
    const consumer = build({ baseUrl: null });
    await expect(consumer.handle(event('order.unknown', {}))).rejects.toThrow(
      '구독하지 않은 outbox 이벤트',
    );
  });
});
