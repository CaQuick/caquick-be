import type { ConfigService } from '@nestjs/config';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

import type { OutboxConfig } from '@/config/outbox.config';
import type { OutboxConsumerRegistry } from '@/features/outbox/rabbitmq/outbox-consumer-registry.service';
import type { RabbitConnectionService } from '@/features/outbox/rabbitmq/rabbit-connection.service';
import { queuesFor } from '@/features/outbox/rabbitmq/topology';
import { RabbitConsumerHostService } from '@/features/outbox/services/rabbit-consumer-host.service';
import type { AlertService } from '@/global/alerting';
import { RequestContextService } from '@/global/request-context';

type ConsumeCb = (message: ConsumeMessage | null) => void;

/** 브로커 없이 채널 수명주기만 흉내 낸다 — consume 도중 밀린 메시지 도착·confirm 없는 publish·consume 실패. */
function fakeChannel(opts: {
  deliverOnConsume?: string[];
  failConsumeFor?: string[];
  confirm?: boolean;
}) {
  const consumers = new Map<string, ConsumeCb>();
  const channel = {
    ack: jest.fn(),
    nack: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
    prefetch: jest.fn().mockResolvedValue(undefined),
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    publish: (
      _ex: string,
      _rk: string,
      _content: Buffer,
      _opts: unknown,
      cb: (error: unknown) => void,
    ) => {
      if (opts.confirm !== false) cb(null);
      return true;
    },
    consume: (queue: string, cb: ConsumeCb) => {
      if (opts.failConsumeFor?.includes(queue)) {
        return Promise.reject(new Error(`consume ${queue} 실패`));
      }
      consumers.set(queue, cb);
      // 큐에 밀린 메시지는 consume이 걸리는 즉시 온다 — start()의 나머지 큐 등록이 끝나기 전
      if (opts.deliverOnConsume?.includes(queue)) cb(message('backlog'));
      return Promise.resolve({ consumerTag: `tag-${queue}` });
    },
    deliver: (queue: string, msg: ConsumeMessage) =>
      consumers.get(queue)?.(msg),
  };
  return channel;
}

function message(eventId: string): ConsumeMessage {
  return {
    content: Buffer.from(
      JSON.stringify({
        id: '1',
        eventId,
        aggregateType: 'test',
        aggregateId: 'A',
        eventType: 'test.a',
        payload: {},
        occurredAt: '2026-09-24T12:00:00.000Z',
        actorAccountId: null,
        clientIp: null,
        userAgent: null,
      }),
    ),
    properties: {
      headers: {},
      messageId: eventId,
    } as ConsumeMessage['properties'],
    fields: {} as ConsumeMessage['fields'],
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('RabbitConsumerHostService (fake channel — 채널 수명주기)', () => {
  const cfg: OutboxConfig = {
    dispatchEnabled: false,
    pollIntervalMs: 1_000,
    batchSize: 100,
    maxAttempts: 2,
    partitionConcurrency: 4,
  };
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };
  beforeEach(() => alerts.notify.mockClear());

  function build(
    channel: ReturnType<typeof fakeChannel>,
    handle: () => Promise<void>,
    names = ['A'],
  ) {
    const host = new RabbitConsumerHostService(
      { getOrThrow: () => cfg } as unknown as ConfigService,
      {
        createConfirmChannel: () =>
          Promise.resolve(channel as unknown as ConfirmChannel),
      } as unknown as RabbitConnectionService,
      {
        resolve: () =>
          names.map((name) => ({
            name,
            eventTypes: ['test.a'],
            instance: { handle },
            queues: queuesFor(name),
          })),
      } as unknown as OutboxConsumerRegistry,
      alerts as unknown as AlertService,
      new RequestContextService(),
    );
    return host;
  }

  it('반증: 첫 큐에 밀린 메시지가 start() 도중 오면 채널이 이미 활성이라 ack된다 — 아니면 prefetch 1 소비자가 영영 멈춘다', async () => {
    const channel = fakeChannel({ deliverOnConsume: ['q.A'] });
    const host = build(channel, () => Promise.resolve(), ['A', 'B']);

    await host.start();
    await flush();

    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(host.isConsuming).toBe(true);
  });

  it('반증: 뒤쪽 큐의 consume이 실패하면 start()는 던지고 채널을 닫아 앞쪽 소비도 되돌린다', async () => {
    const channel = fakeChannel({ failConsumeFor: ['q.B'] });
    const host = build(channel, () => Promise.resolve(), ['A', 'B']);

    await expect(host.start()).rejects.toThrow('consume q.B 실패');

    expect(channel.close).toHaveBeenCalled();
    expect(host.isConsuming).toBe(false);
  });

  it('반증: retry/DLQ 재발행 confirm이 상한 안에 오지 않으면 채널을 닫는다(브로커가 unack를 재전달·재시작) — 영영 기다리지 않는다', async () => {
    const channel = fakeChannel({ confirm: false });
    const host = build(channel, () => Promise.reject(new Error('handle 실패')));
    host.moveConfirmTimeoutMs = 20;

    await host.start();
    channel.deliver('q.A', message('e-1'));
    await new Promise((r) => setTimeout(r, 80));

    expect(channel.close).toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
    expect(host.isConsuming).toBe(false);
    // 옮기지 못했으므로 "retry/DLQ로 보냈다"는 경보를 내지 않는다
    expect(alerts.notify).not.toHaveBeenCalled();
    await host.onModuleDestroy(); // in-flight가 끝나 있어 즉시 돌아온다
  });

  it('반증: 브로커가 없을 때 종료하면 재연결 sleep(최대 30초)을 깨워 바로 돌아온다', async () => {
    const host = build(
      {
        ...fakeChannel({}),
        assertExchange: jest.fn().mockRejectedValue(new Error('broker down')),
      },
      () => Promise.resolve(),
    );
    cfg.dispatchEnabled = true;
    host.onApplicationBootstrap();
    cfg.dispatchEnabled = false;
    await flush();

    const started = Date.now();
    await host.onModuleDestroy();
    expect(Date.now() - started).toBeLessThan(500);
  });
});
