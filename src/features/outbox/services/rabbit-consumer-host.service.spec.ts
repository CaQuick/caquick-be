import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { ConfirmChannel } from 'amqplib';
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

import type { OutboxConfig } from '@/config/outbox.config';
import { SubscribeOutbox } from '@/features/outbox/decorators/subscribe-outbox.decorator';
import { OutboxConsumerRegistry } from '@/features/outbox/rabbitmq/outbox-consumer-registry.service';
import { RabbitConnectionService } from '@/features/outbox/rabbitmq/rabbit-connection.service';
import { RabbitHealthIndicator } from '@/features/outbox/rabbitmq/rabbit-health.indicator';
import {
  ATTEMPTS_HEADER,
  EVENTS_EXCHANGE,
  type OutboxMessage,
  queuesFor,
  RETRY_EXCHANGE,
} from '@/features/outbox/rabbitmq/topology';
import { RabbitConsumerHostService } from '@/features/outbox/services/rabbit-consumer-host.service';
import type {
  OutboxConsumer,
  OutboxEvent,
} from '@/features/outbox/types/outbox-event.type';
import { AlertService } from '@/global/alerting';
import { RequestContextService } from '@/global/request-context';
import { requestContextStorage } from '@/global/request-context/request-context.service';

/** 받은 이벤트·시각·ALS eventId를 기록하고, 이벤트별로 남은 실패 횟수만큼 던진다(at-least-once가 그대로 드러난다). */
@Injectable()
@SubscribeOutbox('test.a')
class RecordingConsumer implements OutboxConsumer {
  received: OutboxEvent[] = [];
  receivedAt: number[] = [];
  contextEventIds: Array<string | undefined> = [];
  failuresLeft = new Map<string, number>();
  block: Promise<void> | null = null;

  async handle(event: OutboxEvent): Promise<void> {
    this.received.push(event);
    this.receivedAt.push(Date.now());
    this.contextEventIds.push(requestContextStorage.getStore()?.eventId);
    if (this.block) await this.block;
    const left = this.failuresLeft.get(event.eventId) ?? 0;
    if (left > 0) {
      this.failuresLeft.set(event.eventId, left - 1);
      throw new Error(`consumer failure ${event.eventId}`);
    }
  }
}

function message(eventId: string): OutboxMessage {
  return {
    id: '1',
    eventId,
    aggregateType: 'test',
    aggregateId: 'A',
    eventType: 'test.a',
    payload: { n: 1 },
    occurredAt: '2026-09-24T12:00:00.000Z',
    actorAccountId: null,
    clientIp: null,
    userAgent: null,
  };
}

async function until(
  cond: () => boolean | Promise<boolean>,
  ms = 5_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > deadline)
      throw new Error('조건이 시간 안에 참이 되지 않았다');
    await new Promise((r) => setTimeout(r, 50));
  }
}

// 브로커도 mock하지 않는다 — 큐·바인딩·retry TTL·DLQ가 실제 RabbitMQ에서 그대로 동작하는지 본다.
describe('RabbitConsumerHostService (real RabbitMQ)', () => {
  let container: StartedTestContainer;
  let host: RabbitConsumerHostService;
  let rabbit: RabbitConnectionService;
  let registry: OutboxConsumerRegistry;
  let requestContext: RequestContextService;
  let consumer: RecordingConsumer;
  let publisher: ConfirmChannel;
  const queues = queuesFor('RecordingConsumer');
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };
  const outboxCfg: OutboxConfig = {
    dispatchEnabled: false,
    pollIntervalMs: 1_000,
    batchSize: 100,
    maxAttempts: 2,
    partitionConcurrency: 4,
  };
  const config = {
    getOrThrow: (key: string) => (key === 'rabbitmq' ? { url: '' } : outboxCfg),
  };
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    process.on('unhandledRejection', onUnhandled);
    container = await new GenericContainer('rabbitmq:4-alpine')
      .withExposedPorts(5672)
      .withWaitStrategy(Wait.forLogMessage('Server startup complete'))
      .withStartupTimeout(120_000)
      .start();
    config.getOrThrow = (key: string) =>
      key === 'rabbitmq'
        ? {
            url: `amqp://guest:guest@${container.getHost()}:${container.getMappedPort(5672)}`,
          }
        : outboxCfg;
    const module = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [
        RabbitConsumerHostService,
        RabbitConnectionService,
        OutboxConsumerRegistry,
        RequestContextService,
        RecordingConsumer,
        { provide: AlertService, useValue: alerts },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    host = module.get(RabbitConsumerHostService);
    rabbit = module.get(RabbitConnectionService);
    registry = module.get(OutboxConsumerRegistry);
    requestContext = module.get(RequestContextService);
    consumer = module.get(RecordingConsumer);
    await host.start();
    publisher = await rabbit.createConfirmChannel();
  }, 150_000);

  afterAll(async () => {
    await host.onModuleDestroy();
    await rabbit.onModuleDestroy();
    await container.stop({ timeout: 5_000 });
    process.off('unhandledRejection', onUnhandled);
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    consumer.received = [];
    consumer.receivedAt = [];
    consumer.contextEventIds = [];
    consumer.failuresLeft.clear();
    consumer.block = null;
    alerts.notify.mockClear();
    unhandled.length = 0;
    for (const q of [queues.main, queues.retry, queues.dlq]) {
      await publisher.purgeQueue(q);
    }
  });

  async function publish(body: string, routingKey = 'test.a'): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      publisher.publish(
        EVENTS_EXCHANGE,
        routingKey,
        Buffer.from(body),
        { messageId: `m-${Math.random()}` },
        (e) => (e ? reject(new Error('publish 실패')) : resolve()),
      );
    });
  }
  async function count(queue: string): Promise<number> {
    return (await publisher.checkQueue(queue)).messageCount;
  }

  it('event_type으로 바인딩된 큐에서 받아 OutboxEvent로 넘기고 ack한다 — handle은 ALS eventId 안에서 돈다', async () => {
    await publish(JSON.stringify(message('e-1')));

    await until(() => consumer.received.length === 1);
    expect(consumer.received[0]).toMatchObject({
      eventId: 'e-1',
      eventType: 'test.a',
      payload: { n: 1 },
      attempts: 0,
    });
    expect(consumer.received[0].occurredAt).toEqual(
      new Date('2026-09-24T12:00:00.000Z'),
    );
    expect(consumer.contextEventIds).toEqual(['e-1']);
    await until(async () => (await count(queues.main)) === 0);
    expect(await count(queues.dlq)).toBe(0);
  });

  it('구독하지 않은 event_type은 이 큐로 오지 않는다', async () => {
    await publish(
      JSON.stringify({ ...message('e-x'), eventType: 'test.other' }),
      'test.other',
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(consumer.received).toHaveLength(0);
  });

  it('실패하면 retry 큐에 머물다(per-message TTL) DLX를 거쳐 백오프 뒤 attempts+1로 다시 온다(at-least-once)', async () => {
    consumer.failuresLeft.set('e-2', 1);
    await publish(JSON.stringify(message('e-2')));

    // 첫 실패 직후: retry 큐에 1건, 본 큐는 비어 있다 — 직접 재발행이 아니라 retry 큐를 거친다
    await until(async () => (await count(queues.retry)) === 1);
    expect(await count(queues.main)).toBe(0);
    expect(consumer.received).toHaveLength(1);

    await until(() => consumer.received.length === 2, 8_000);
    expect(consumer.received.map((e) => e.attempts)).toEqual([0, 1]);
    // 두 번째 수신은 백오프(1초) 뒤 — TTL 만료를 실제로 기다렸다
    expect(
      consumer.receivedAt[1] - consumer.receivedAt[0],
    ).toBeGreaterThanOrEqual(900);
    expect(await count(queues.dlq)).toBe(0);
  });

  it('반증: 상한을 채우면 DLQ에 남기고 경보 1건(재처리 명령 포함), 본 큐는 비운다', async () => {
    consumer.failuresLeft.set('e-3', 99);
    await publish(JSON.stringify(message('e-3')));

    await until(() => consumer.received.length === 2, 8_000);
    await until(() => alerts.notify.mock.calls.length === 1);
    expect(await count(queues.dlq)).toBe(1);
    expect(await count(queues.main)).toBe(0);
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'outbox 소비 DLQ',
        key: 'outbox-dlq:RecordingConsumer',
        detail: expect.stringContaining(
          'yarn outbox:requeue --event-id=e-3 --republish',
        ) as string,
      }),
    );
    // DLQ 메시지는 시도 횟수 헤더를 지닌다(재발행 시 참고)
    const dead = await publisher.get(queues.dlq, { noAck: true });
    expect(dead && dead.properties.headers?.[ATTEMPTS_HEADER]).toBe(2);
  });

  it('반증: 깨진 본문은 재시도 없이 바로 DLQ + 경보', async () => {
    await publish('not json');

    await until(() => alerts.notify.mock.calls.length === 1);
    expect(await count(queues.dlq)).toBe(1);
    expect(consumer.received).toHaveLength(0);
  });

  it('반증: 처리 중 채널이 닫혀도 프로세스가 죽지 않고(unhandled rejection 0) 브로커가 재전달한다', async () => {
    let release: () => void = () => undefined;
    consumer.block = new Promise<void>((r) => {
      release = r;
    });
    await publish(JSON.stringify(message('e-4')));
    await until(() => consumer.received.length === 1);

    // 브로커 쪽 사정(재시작 등)으로 소비 채널이 닫힌다 → 호스트는 새 채널로 재시작한다
    const channel = (host as unknown as { channel: ConfirmChannel }).channel;
    await channel.close();
    release();

    // unack 상태였던 메시지는 새 소비 채널로 다시 온다
    await until(() => consumer.received.length === 2, 10_000);
    await new Promise((r) => setTimeout(r, 100));
    expect(unhandled).toEqual([]);
    expect(host.isConsuming).toBe(true);
  });

  it('반증: 큐 인자가 다르면(406) 시작은 실패하지만 공유 커넥션과 다른 채널은 살아 있고, 영구 오류 경보가 난다', async () => {
    const other = new RabbitConsumerHostService(
      config as unknown as ConfigService,
      rabbit,
      {
        resolve: () => [
          {
            ...registry.resolve()[0],
            name: 'Mismatch',
            queues: queuesFor('Mismatch'),
          },
        ],
      } as OutboxConsumerRegistry,
      alerts as unknown as AlertService,
      requestContext,
    );
    // "이전 배포"가 남긴 다른 인자의 큐
    const setup = await rabbit.createConfirmChannel();
    await setup.assertQueue('q.Mismatch.retry', {
      durable: true,
      deadLetterExchange: RETRY_EXCHANGE,
      deadLetterRoutingKey: 'q.Mismatch',
      maxLength: 10,
    });
    await setup.close();

    await expect(other.start()).rejects.toMatchObject({ code: 406 });
    expect(rabbit.isConnected('consumer')).toBe(true);
    await expect(publisher.checkQueue(queues.main)).resolves.toBeDefined(); // 다른 채널은 멀쩡

    outboxCfg.dispatchEnabled = true;
    other.onApplicationBootstrap();
    await until(() =>
      alerts.notify.mock.calls.some(
        ([m]) =>
          (m as { key: string }).key === 'outbox-consumer-start:permanent',
      ),
    );
    outboxCfg.dispatchEnabled = false;
    await other.onModuleDestroy();
    const cleanup = await rabbit.createConfirmChannel();
    await cleanup.deleteQueue('q.Mismatch.retry');
    await cleanup.close();
  });

  it('헬스 지표는 왕복 RPC로 확인한다 — 커넥션이 없으면 실패', async () => {
    await expect(
      new RabbitHealthIndicator(rabbit).check(),
    ).resolves.toBeUndefined();
    const dead = {
      createConfirmChannel: () => Promise.reject(new Error('down')),
    } as unknown as RabbitConnectionService;
    await expect(new RabbitHealthIndicator(dead).check()).rejects.toThrow(
      'down',
    );
  });
});
