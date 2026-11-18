import type { ConfigService } from '@nestjs/config';

import { ClockService } from '@/common/providers/clock.service';
import type { AdminWebConfig } from '@/config/admin-web.config';
import type { AlertingConfig } from '@/config/alerting.config';
import { ORDER_PAYMENT_PENDING } from '@/features/order/events/order-payment-pending.event';
import { PAYMENT_DEPOSIT_CLAIMED } from '@/features/order/events/payment-deposit-claimed.event';
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

  it.each([
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
