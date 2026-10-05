import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClockService } from '@/common/providers/clock.service';
import type { ExpoPushConfig } from '@/config/expo-push.config';
import { SellerPushDeliveryRepository } from '@/features/notification/repositories/seller-push-delivery.repository';
import { SellerPushDeviceRepository } from '@/features/notification/repositories/seller-push-device.repository';
import { SellerPushOutboxConsumer } from '@/features/notification/services/seller-push-outbox.consumer';
import type { OutboxEvent } from '@/features/outbox';
import type { PrismaClient } from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import {
  EXPO_PUSH_TRANSPORT,
  ExpoPushAuthError,
  ExpoPushHttpError,
  type ExpoPushMessage,
  type ExpoPushTicket,
  type ExpoPushTransport,
} from '@/global/expo-push';
import { MetricsService } from '@/global/metrics';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createSellerPushDevice, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_EVENT_ID = '22222222-2222-4222-8222-222222222222';

function event(
  eventType: string,
  payload: OutboxEvent['payload'],
  eventId = EVENT_ID,
): OutboxEvent {
  return {
    id: 1n,
    eventId,
    aggregateType: 'test',
    aggregateId: '1',
    eventType,
    payload,
    occurredAt: NOW,
    actorAccountId: null,
    clientIp: null,
    userAgent: null,
    attempts: 0,
  };
}

function orderSubmitted(storeId: bigint, eventId = EVENT_ID): OutboxEvent {
  return event(
    'order.submitted',
    {
      orderId: '42',
      orderNumber: 'ORD-1',
      buyerAccountId: '7',
      storeId: storeId.toString(),
      storeName: '케이크샵',
      productId: '9',
      productName: '레터링 케이크',
      quantity: 2,
      pickupAt: '2026-10-05T03:05:00.000Z',
      totalPrice: 50000,
    },
    eventId,
  );
}

function okTickets(messages: ExpoPushMessage[]): ExpoPushTicket[] {
  return messages.map((m) => ({ status: 'ok', id: `ticket:${m.to}` }));
}

// 판매자 푸시 전송 — 매장 디바이스 fan-out, 재전달 멱등(ticket 기록 행 제외), 배치 100, ticket 오류·인증 실패 처리.
describe('SellerPushOutboxConsumer (real DB)', () => {
  let consumer: SellerPushOutboxConsumer;
  let deliveryRepository: SellerPushDeliveryRepository;
  let metrics: MetricsService;
  let prisma: PrismaClient;
  let cfg: ExpoPushConfig;
  const send = jest.fn<
    Promise<ExpoPushTicket[]>,
    Parameters<ExpoPushTransport['send']>
  >();
  const transport: ExpoPushTransport = {
    send,
    getReceipts: jest.fn(),
  };
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerPushOutboxConsumer,
        SellerPushDeviceRepository,
        SellerPushDeliveryRepository,
        MetricsService,
        { provide: ClockService, useValue: { now: () => NOW } },
        { provide: ConfigService, useValue: { getOrThrow: () => cfg } },
        { provide: AlertService, useValue: alerts },
        { provide: EXPO_PUSH_TRANSPORT, useValue: transport },
      ],
    });
    consumer = module.get(SellerPushOutboxConsumer);
    deliveryRepository = module.get(SellerPushDeliveryRepository);
    metrics = module.get(MetricsService);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
    cfg = { enabled: true, accessToken: 'tok', requestTimeoutMs: 1_000 };
    send.mockReset();
    send.mockImplementation((messages) => Promise.resolve(okTickets(messages)));
    alerts.notify.mockClear();
    metrics.expoPushSends.reset();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  async function storeWithDevices(count: number) {
    const seller = await setupSellerWithStore(prisma);
    const devices = [];
    for (let i = 0; i < count; i++) {
      devices.push(
        await createSellerPushDevice(prisma, {
          account_id: seller.account.id,
          store_id: seller.store.id,
        }),
      );
    }
    return { storeId: seller.store.id, devices };
  }

  async function sendsCounter(): Promise<Record<string, number>> {
    const { values } = await metrics.expoPushSends.get();
    return Object.fromEntries(
      values.map((v) => [v.labels.result as string, v.value]),
    );
  }

  const deliveries = () =>
    prisma.sellerPushDelivery.findMany({ orderBy: { id: 'asc' } });

  describe('order.submitted', () => {
    it('매장의 활성 디바이스마다 메시지를 한 요청으로 보내고 ticket을 행에 기록한다', async () => {
      const { storeId, devices } = await storeWithDevices(2);

      await consumer.handle(orderSubmitted(storeId));

      expect(send).toHaveBeenCalledTimes(1);
      const [messages, options] = send.mock.calls[0];
      expect(options).toEqual({ accessToken: 'tok', timeoutMs: 1_000 });
      expect(messages).toEqual(
        devices.map((d) => ({
          to: d.expo_push_token,
          title: '새 주문',
          body: '레터링 케이크 2개 · 픽업 10/5 12:05',
          data: { kind: 'ORDER_SUBMITTED', orderId: '42' },
          channelId: 'default',
        })),
      );
      const rows = await deliveries();
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.push_device_id)).toEqual(
        devices.map((d) => d.id),
      );
      expect(rows[0]).toMatchObject({
        source_event_id: EVENT_ID,
        status: 'TICKET_OK',
        ticket_id: `ticket:${devices[0].expo_push_token}`,
        error_code: null,
        sent_at: NOW,
        receipt_checked_at: null,
      });
      expect(await sendsCounter()).toEqual({ TICKET_OK: 2 });
    });

    it('해제된 디바이스와 다른 매장의 디바이스는 대상이 아니다', async () => {
      const { storeId, devices } = await storeWithDevices(1);
      await createSellerPushDevice(prisma, {
        store_id: storeId,
        account_id: devices[0].account_id,
        disabled_at: NOW,
        disabled_reason: 'UNREGISTERED',
      });
      await createSellerPushDevice(prisma);

      await consumer.handle(orderSubmitted(storeId));

      expect(send.mock.calls[0][0].map((m) => m.to)).toEqual([
        devices[0].expo_push_token,
      ]);
      expect(await prisma.sellerPushDelivery.count()).toBe(1);
    });

    it('디바이스가 없으면 보내지 않고 행도 남기지 않는다', async () => {
      const { storeId } = await storeWithDevices(0);

      await consumer.handle(orderSubmitted(storeId));

      expect(send).not.toHaveBeenCalled();
      expect(await prisma.sellerPushDelivery.count()).toBe(0);
    });

    it('같은 이벤트 재전달은 다시 보내지 않는다 — 반증: 다른 이벤트는 보낸다', async () => {
      const { storeId } = await storeWithDevices(2);
      await consumer.handle(orderSubmitted(storeId));
      expect(send).toHaveBeenCalledTimes(1);

      await consumer.handle(orderSubmitted(storeId));
      expect(send).toHaveBeenCalledTimes(1);
      expect(await prisma.sellerPushDelivery.count()).toBe(2);

      await consumer.handle(orderSubmitted(storeId, OTHER_EVENT_ID));
      expect(send).toHaveBeenCalledTimes(2);
      expect(await prisma.sellerPushDelivery.count()).toBe(4);
    });

    it('디바이스 150개는 100 + 50 두 요청으로 나눈다', async () => {
      const { storeId } = await storeWithDevices(150);

      await consumer.handle(orderSubmitted(storeId));

      expect(send.mock.calls.map(([m]) => m.length)).toEqual([100, 50]);
      expect(
        await prisma.sellerPushDelivery.count({
          where: { status: 'TICKET_OK' },
        }),
      ).toBe(150);
      expect(await sendsCounter()).toEqual({ TICKET_OK: 150 });
    });

    it('ticket DeviceNotRegistered는 행에 오류 코드를 남기고 그 디바이스만 비활성한다', async () => {
      const { storeId, devices } = await storeWithDevices(2);
      send.mockResolvedValue([
        {
          status: 'error',
          message: 'not registered',
          details: { error: 'DeviceNotRegistered' },
        },
        { status: 'ok', id: 't-2' },
      ]);

      await consumer.handle(orderSubmitted(storeId));

      const rows = await deliveries();
      expect(rows[0]).toMatchObject({
        status: 'TICKET_ERROR',
        error_code: 'DeviceNotRegistered',
        ticket_id: null,
        sent_at: NOW,
      });
      expect(rows[1]).toMatchObject({ status: 'TICKET_OK', ticket_id: 't-2' });
      const [gone, alive] = await prisma.sellerPushDevice.findMany({
        where: { id: { in: devices.map((d) => d.id) } },
        orderBy: { id: 'asc' },
      });
      expect(gone).toMatchObject({
        disabled_at: NOW,
        disabled_reason: 'DEVICE_NOT_REGISTERED',
      });
      expect(alive.disabled_at).toBeNull();
      expect(await sendsCounter()).toEqual({ TICKET_ERROR: 1, TICKET_OK: 1 });
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    it('ticket 기록(markTickets)이 던져도 DeviceNotRegistered 디바이스는 이미 비활성이다', async () => {
      const { storeId, devices } = await storeWithDevices(1);
      send.mockResolvedValue([
        {
          status: 'error',
          message: 'not registered',
          details: { error: 'DeviceNotRegistered' },
        },
      ]);
      jest
        .spyOn(deliveryRepository, 'markTickets')
        .mockRejectedValueOnce(new Error('db down'));

      await expect(consumer.handle(orderSubmitted(storeId))).rejects.toThrow(
        'db down',
      );

      expect(
        await prisma.sellerPushDevice.findUniqueOrThrow({
          where: { id: devices[0].id },
        }),
      ).toMatchObject({
        disabled_at: NOW,
        disabled_reason: 'DEVICE_NOT_REGISTERED',
      });
      expect((await deliveries())[0].status).toBe('PENDING');
    });

    it('오류 코드가 없는 ticket 오류는 UNKNOWN으로 남기고 디바이스는 살려 둔다', async () => {
      const { storeId, devices } = await storeWithDevices(1);
      send.mockResolvedValue([{ status: 'error', message: 'too big' }]);

      await consumer.handle(orderSubmitted(storeId));

      expect((await deliveries())[0]).toMatchObject({
        status: 'TICKET_ERROR',
        error_code: 'UNKNOWN',
      });
      expect(
        (
          await prisma.sellerPushDevice.findUniqueOrThrow({
            where: { id: devices[0].id },
          })
        ).disabled_at,
      ).toBeNull();
    });

    it('전송이 던지면 그대로 던지고 행은 PENDING으로 남아 재전달 때 다시 보낸다', async () => {
      const { storeId, devices } = await storeWithDevices(2);
      send.mockRejectedValueOnce(new ExpoPushHttpError(503, 'Expo 푸시 전송'));

      await expect(consumer.handle(orderSubmitted(storeId))).rejects.toThrow(
        'HTTP 503',
      );
      expect((await deliveries()).map((r) => r.status)).toEqual([
        'PENDING',
        'PENDING',
      ]);
      expect(alerts.notify).not.toHaveBeenCalled();
      expect(await sendsCounter()).toEqual({});

      await consumer.handle(orderSubmitted(storeId));

      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1][0].map((m) => m.to)).toEqual(
        devices.map((d) => d.expo_push_token),
      );
      expect((await deliveries()).map((r) => r.status)).toEqual([
        'TICKET_OK',
        'TICKET_OK',
      ]);
    });

    it('두 번째 배치만 실패하면 첫 배치는 기록되고 재전달은 남은 50개만 보낸다', async () => {
      const { storeId } = await storeWithDevices(150);
      send
        .mockImplementationOnce((messages) =>
          Promise.resolve(okTickets(messages)),
        )
        .mockRejectedValueOnce(new Error('fetch failed'));

      await expect(consumer.handle(orderSubmitted(storeId))).rejects.toThrow(
        'fetch failed',
      );
      expect(
        await prisma.sellerPushDelivery.groupBy({
          by: ['status'],
          _count: true,
          orderBy: { status: 'asc' },
        }),
      ).toEqual([
        { status: 'PENDING', _count: 50 },
        { status: 'TICKET_OK', _count: 100 },
      ]);

      await consumer.handle(orderSubmitted(storeId));

      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls[2][0]).toHaveLength(50);
      expect(
        await prisma.sellerPushDelivery.count({ where: { status: 'PENDING' } }),
      ).toBe(0);
    });

    it('401·403은 인증 실패 경보를 낸 뒤 던진다', async () => {
      const { storeId } = await storeWithDevices(2);
      send.mockRejectedValue(new ExpoPushAuthError(401, 'Expo 푸시 전송'));

      await expect(
        consumer.handle(orderSubmitted(storeId)),
      ).rejects.toBeInstanceOf(ExpoPushAuthError);

      expect(alerts.notify).toHaveBeenCalledTimes(1);
      expect(alerts.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          title: 'Expo 푸시 인증 실패',
          key: 'expo-push:auth',
          detail: expect.stringContaining('HTTP 401'),
        }),
      );
      expect((await deliveries()).map((r) => r.status)).toEqual([
        'PENDING',
        'PENDING',
      ]);
      expect(await sendsCounter()).toEqual({ AUTH_ERROR: 2 });
    });

    it('EXPO_PUSH_ENABLED=false면 디바이스가 있어도 보내지 않고 이력도 남기지 않는다', async () => {
      cfg = { ...cfg, enabled: false };
      const { storeId } = await storeWithDevices(1);

      await consumer.handle(orderSubmitted(storeId));

      expect(send).not.toHaveBeenCalled();
      expect(await prisma.sellerPushDelivery.count()).toBe(0);
      expect(Logger.prototype.debug).toHaveBeenCalled();
    });

    it('반증: payload 형식이 어긋나면 던진다(전송·행 없음)', async () => {
      const { storeId } = await storeWithDevices(1);
      const broken = orderSubmitted(storeId);
      broken.payload = { ...(broken.payload as object), quantity: '2' };

      await expect(consumer.handle(broken)).rejects.toThrow(
        'order.submitted payload 형식 오류',
      );
      expect(send).not.toHaveBeenCalled();
      expect(await prisma.sellerPushDelivery.count()).toBe(0);
    });
  });

  it('conversation.buyer_message_sent는 preview를 본문으로, 딥링크는 대화 id', async () => {
    const { storeId, devices } = await storeWithDevices(1);

    await consumer.handle(
      event('conversation.buyer_message_sent', {
        conversationId: '11',
        storeId: storeId.toString(),
        buyerAccountId: '7',
        messageId: '99',
        preview: '픽업 시간 바꿀 수 있나요?',
        messageCreatedAt: '2026-10-05T03:05:00.000Z',
      }),
    );

    expect(send.mock.calls[0][0]).toEqual([
      {
        to: devices[0].expo_push_token,
        title: '새 문의',
        body: '픽업 시간 바꿀 수 있나요?',
        data: { kind: 'BUYER_MESSAGE', conversationId: '11' },
        channelId: 'default',
      },
    ]);
    expect((await deliveries())[0].status).toBe('TICKET_OK');
  });

  it('반증: 구독하지 않은 event_type은 던진다', async () => {
    await expect(
      consumer.handle(event('order.status_changed', {})),
    ).rejects.toThrow('구독하지 않은 outbox 이벤트: order.status_changed');
    expect(send).not.toHaveBeenCalled();
  });
});
