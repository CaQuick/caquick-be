import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfirmChannel } from 'amqplib';

import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';
import type { OutboxConfig } from '@/config/outbox.config';
import { OutboxConsumerRegistry } from '@/features/outbox/rabbitmq/outbox-consumer-registry.service';
import { RabbitConnectionService } from '@/features/outbox/rabbitmq/rabbit-connection.service';
import {
  DLQ_EXCHANGE,
  EVENTS_EXCHANGE,
  queuesFor,
  RETRY_EXCHANGE,
} from '@/features/outbox/rabbitmq/topology';
import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import { OutboxPublisher } from '@/features/outbox/services/outbox-publisher.service';
import { OutboxRelayService } from '@/features/outbox/services/outbox-relay.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const START = new Date('2026-09-24T12:00:00.000Z');

type PublishCb = (error: Error | null) => void;
interface Published {
  exchange: string;
  routingKey: string;
  body: Record<string, unknown>;
  options: Record<string, unknown>;
}

type Listener = (payload: unknown) => void;

/**
 * 브로커 없이 publisher confirm만 흉내 낸다. eventId별로 — failNext: confirm nack, hangNext: confirm 없음,
 * throwNext: 채널 예외(닫힘), returnNext: 라우팅 실패('return' 뒤 confirm ack — 브로커의 실제 순서).
 */
function fakeChannel() {
  const published: Published[] = [];
  const failNext = new Set<string>();
  const hangNext = new Set<string>();
  const throwNext = new Set<string>();
  const returnNext = new Set<string>();
  const listeners = new Map<string, Listener[]>();
  const channel = {
    published,
    failNext,
    hangNext,
    throwNext,
    returnNext,
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    on: (event: string, fn: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
    publish: (
      exchange: string,
      routingKey: string,
      content: Buffer,
      options: Record<string, unknown>,
      cb: PublishCb,
    ) => {
      const body = JSON.parse(content.toString('utf8')) as Record<
        string,
        unknown
      >;
      const eventId = String(body.eventId);
      if (throwNext.has(eventId)) throw new Error('Channel closed');
      if (hangNext.has(eventId)) return true;
      if (failNext.has(eventId)) {
        cb(new Error('basic.nack'));
        return true;
      }
      if (returnNext.has(eventId)) {
        for (const fn of listeners.get('return') ?? []) {
          fn({ properties: { messageId: options.messageId } });
        }
      }
      published.push({ exchange, routingKey, body, options });
      cb(null);
      return true;
    },
  };
  return channel;
}

describe('OutboxRelayService (real DB, fake channel)', () => {
  let relay: OutboxRelayService;
  let publisher: OutboxPublisher;
  let prisma: PrismaClient;
  let channel: ReturnType<typeof fakeChannel>;
  let now = START;
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };
  const cfg: OutboxConfig = {
    dispatchEnabled: false,
    pollIntervalMs: 1_000,
    batchSize: 100,
    maxAttempts: 3,
    partitionConcurrency: 4,
  };
  /** 소비자 호스트와 같은 목록 — 릴레이도 이 큐를 선언해야 소비자가 아직 없을 때 발행한 메시지가 버려지지 않는다 */
  const registry = {
    resolve: () => [
      {
        name: 'X',
        eventTypes: ['test.a'],
        instance: {},
        queues: queuesFor('X'),
      },
    ],
  };

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OutboxRelayService,
        OutboxPublisher,
        OutboxRepository,
        IdGenerator,
        { provide: AlertService, useValue: alerts },
        { provide: ClockService, useValue: { now: () => now } },
        { provide: ConfigService, useValue: { getOrThrow: () => cfg } },
        { provide: OutboxConsumerRegistry, useValue: registry },
        {
          provide: RabbitConnectionService,
          useValue: {
            createConfirmChannel: () =>
              Promise.resolve(channel as unknown as ConfirmChannel),
          },
        },
      ],
    });
    relay = module.get(OutboxRelayService);
    publisher = module.get(OutboxPublisher);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
    jest.restoreAllMocks();
  });
  beforeEach(async () => {
    await truncateAll();
    now = START;
    channel = fakeChannel();
    // 채널은 릴레이가 캐시하므로 케이스마다 새로 받게 초기화한다
    (relay as unknown as { channel: unknown }).channel = null;
    alerts.notify.mockClear();
  });

  async function enqueue(aggregateId: string, n: number, eventType = 'test.a') {
    return prisma.$transaction((tx) =>
      publisher.publish(tx, {
        aggregateType: 'test',
        aggregateId,
        eventType,
        payload: { n },
      }),
    );
  }
  async function rowOf(eventId: string) {
    return prisma.outbox.findUniqueOrThrow({ where: { event_id: eventId } });
  }

  it('채널을 열 때 소비자 호스트와 같은 토폴로지(exchange 3개 + 소비자 큐·바인딩)를 선언한다', async () => {
    await enqueue('A', 1);
    await relay.relayOnce();

    expect(channel.assertExchange).toHaveBeenCalledWith(
      EVENTS_EXCHANGE,
      'topic',
      { durable: true },
    );
    expect(channel.assertQueue).toHaveBeenCalledWith('q.X', { durable: true });
    expect(channel.assertQueue).toHaveBeenCalledWith('q.X.retry', {
      durable: true,
      deadLetterExchange: RETRY_EXCHANGE,
      deadLetterRoutingKey: 'q.X',
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'q.X',
      EVENTS_EXCHANGE,
      'test.a',
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'q.X.dlq',
      DLQ_EXCHANGE,
      'q.X.dlq',
    );
  });

  it('기한이 된 PENDING을 exchange에 event_type 라우팅 키로 싣고 PUBLISHED로 표시한다', async () => {
    const { eventId } = await enqueue('A', 1, 'order.status_changed');

    const summary = await relay.relayOnce();

    expect(summary).toEqual({
      published: 1,
      retried: 0,
      failed: 0,
      deferred: 0,
    });
    expect(channel.published).toHaveLength(1);
    expect(channel.published[0]).toMatchObject({
      exchange: EVENTS_EXCHANGE,
      routingKey: 'order.status_changed',
      body: {
        eventId: eventId,
        eventType: 'order.status_changed',
        payload: { n: 1 },
      },
      // mandatory — 라우팅될 큐가 없으면 'return'이 온다(브로커는 그래도 confirm을 주므로 이 신호가 유일한 증거)
      options: { persistent: true, mandatory: true, messageId: eventId },
    });
    expect((await rowOf(eventId)).status).toBe('PUBLISHED');
  });

  it('반증: 라우팅될 큐가 없어 return이 오면 confirm이 와도 PUBLISHED로 표시하지 않고 경보한다', async () => {
    const { eventId } = await enqueue('A', 1);
    channel.returnNext.add(eventId);

    const summary = await relay.relayOnce();

    expect(summary).toMatchObject({ published: 0, retried: 1 });
    expect((await rowOf(eventId)).status).toBe('PENDING');
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'outbox-unroutable:test.a' }),
    );
    expect(channel.close).not.toHaveBeenCalled(); // 채널은 멀쩡하다
  });

  it('반증: confirm이 상한 안에 오지 않으면 재시도로 남기고 채널을 버리며 정체 경보를 낸다', async () => {
    relay.confirmTimeoutMs = 50;
    const { eventId } = await enqueue('A', 1);
    channel.hangNext.add(eventId);

    const summary = await relay.relayOnce();

    expect(summary).toMatchObject({ published: 0, retried: 1 });
    expect((await rowOf(eventId)).attempts).toBe(1);
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'outbox-relay-stalled' }),
    );
    expect(channel.close).toHaveBeenCalled();
    expect((relay as unknown as { channel: unknown }).channel).toBeNull();
    relay.confirmTimeoutMs = 30_000;
  });

  it('반증: 채널이 죽으면(publish 예외) 그 행만 재시도로 남기고 나머지는 미룬다 — 죽은 채널로 attempts를 올리지 않는다', async () => {
    Object.assign(cfg, { partitionConcurrency: 1 }); // 순차로 돌려 B가 A의 채널 죽음 뒤에 오게 고정
    const a = await enqueue('A', 1);
    const b = await enqueue('B', 1);
    channel.throwNext.add(a.eventId);

    const summary = await relay.relayOnce();
    Object.assign(cfg, { partitionConcurrency: 4 });

    expect(summary).toEqual({
      published: 0,
      retried: 1,
      failed: 0,
      deferred: 1,
    });
    expect((await rowOf(b.eventId)).attempts).toBe(0);
    expect(channel.close).toHaveBeenCalled();
  });

  it('반증: confirm이 실패(nack)하면 PUBLISHED로 표시하지 않고 백오프 재시도로 남긴다 — 채널은 그대로 쓴다', async () => {
    const { eventId } = await enqueue('A', 1);
    channel.failNext.add(eventId);

    const summary = await relay.relayOnce();

    expect(summary).toEqual({
      published: 0,
      retried: 1,
      failed: 0,
      deferred: 0,
    });
    const row = await rowOf(eventId);
    expect(row.status).toBe('PENDING');
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at.getTime()).toBe(START.getTime() + 1_000);
    expect(alerts.notify).not.toHaveBeenCalled();
    expect(channel.close).not.toHaveBeenCalled();
  });

  it('파티션끼리는 partitionConcurrency만큼 병렬로 나가고, 파티션 안은 순차다', async () => {
    Object.assign(cfg, { partitionConcurrency: 2 });
    const order: string[] = [];
    const gate = new Map<string, () => void>();
    channel.publish = (
      exchange: string,
      routingKey: string,
      content: Buffer,
      options: Record<string, unknown>,
      cb: PublishCb,
    ) => {
      const body = JSON.parse(content.toString('utf8')) as Record<
        string,
        unknown
      >;
      const label = `${String(body.aggregateId)}:${String((body.payload as { n: number }).n)}`;
      order.push(label);
      channel.published.push({ exchange, routingKey, body, options });
      if (label === 'A:1') {
        // A:1의 confirm을 잡아 둔다 — B는 기다리지 않고 나가야 한다
        gate.set(label, () => cb(null));
        return true;
      }
      cb(null);
      return true;
    };
    await enqueue('A', 1);
    await enqueue('A', 2);
    await enqueue('B', 1);
    await enqueue('B', 2);

    const relaying = relay.relayOnce();
    // B 파티션이 A:1의 confirm을 기다리지 않고 끝까지 나간다 — A:2는 A:1 confirm 뒤에만
    const deadline = Date.now() + 5_000;
    while (order.length < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(new Set(order)).toEqual(new Set(['A:1', 'B:1', 'B:2'])); // 파티션 시작 순서는 무관
    expect(order).not.toContain('A:2');
    gate.get('A:1')?.();
    const summary = await relaying;

    expect(order).toHaveLength(4);
    expect(order[3]).toBe('A:2');
    expect(order.indexOf('B:1')).toBeLessThan(order.indexOf('B:2'));
    expect(summary).toMatchObject({ published: 4, deferred: 0 });
    Object.assign(cfg, { partitionConcurrency: 4 });
  });

  it('같은 파티션의 앞선 이벤트가 실패하면 뒤는 미룬다(FIFO), 다른 파티션은 나간다', async () => {
    const a1 = await enqueue('A', 1);
    await enqueue('A', 2);
    await enqueue('B', 1);
    channel.failNext.add(a1.eventId);

    const summary = await relay.relayOnce();

    expect(summary).toEqual({
      published: 1,
      retried: 1,
      failed: 0,
      deferred: 1,
    });
    expect(channel.published.map((p) => p.body.aggregateId)).toEqual(['B']);
  });

  it('상한을 채우면 FAILED로 남기고 경보를 1건 보낸다', async () => {
    const { eventId } = await enqueue('A', 1);
    channel.failNext.add(eventId);

    for (let i = 0; i < 3; i++) {
      await relay.relayOnce();
      now = new Date(now.getTime() + 10 * 60_000);
    }

    expect((await rowOf(eventId)).status).toBe('FAILED');
    expect(alerts.notify).toHaveBeenCalledTimes(1);
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        title: 'outbox FAILED',
        key: 'outbox-failed:test.a',
      }),
    );
  });

  it('dispatchEnabled면 pollIntervalMs 간격의 unref 타이머를 걸고, 끄면 걸지 않으며, destroy 시 해제한다', () => {
    const unref = jest.fn();
    const setIntervalSpy = jest
      .spyOn(global, 'setInterval')
      .mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    const clearIntervalSpy = jest
      .spyOn(global, 'clearInterval')
      .mockImplementation(() => undefined);

    cfg.dispatchEnabled = true;
    relay.onApplicationBootstrap();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(unref).toHaveBeenCalled();
    relay.onModuleDestroy();
    expect(clearIntervalSpy).toHaveBeenCalled();

    cfg.dispatchEnabled = false;
    relay.onApplicationBootstrap();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
