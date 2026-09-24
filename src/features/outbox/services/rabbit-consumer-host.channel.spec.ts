import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

import type { OutboxConfig } from '@/config/outbox.config';
import type { OutboxConsumerRegistry } from '@/features/outbox/rabbitmq/outbox-consumer-registry.service';
import type { RabbitConnectionService } from '@/features/outbox/rabbitmq/rabbit-connection.service';
import { queuesFor } from '@/features/outbox/rabbitmq/topology';
import {
  DESTROY_TIMEOUT_MS,
  RabbitConsumerHostService,
} from '@/features/outbox/services/rabbit-consumer-host.service';
import type { AlertService } from '@/global/alerting';
import { MetricsService } from '@/global/metrics';
import { RequestContextService } from '@/global/request-context';

type ConsumeCb = (message: ConsumeMessage | null) => void;

/** 브로커 없이 채널 수명주기만 흉내 낸다 — consume 도중 밀린 메시지 도착·confirm 없는 publish·consume 실패. */
function fakeChannel(opts: {
  deliverOnConsume?: string[];
  failConsumeFor?: string[];
  confirm?: boolean;
  /** 재발행이 라우팅될 큐를 못 찾는다('return' 뒤 confirm) */
  unroutable?: boolean;
  /** 재발행 confirm이 nack으로 온다 */
  nack?: boolean;
  /** ack가 던진다(닫힌 채널에 보낸 것처럼) */
  ackThrows?: boolean;
}) {
  const consumers = new Map<string, ConsumeCb>();
  const listeners = new Map<string, Array<(payload?: unknown) => void>>();
  const channel = {
    ack: jest.fn(() => {
      if (opts.ackThrows)
        throw new Error('IllegalOperationError: Channel closed');
    }),
    nack: jest.fn(),
    // 실제 amqplib처럼 close()는 'close' 리스너를 부른다 — 호스트의 재시작 경로가 여기 걸려 있다
    close: jest.fn(() => {
      for (const fn of listeners.get('close') ?? []) fn();
      return Promise.resolve();
    }),
    cancel: jest.fn().mockResolvedValue(undefined),
    prefetch: jest.fn().mockResolvedValue(undefined),
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    on: (event: string, fn: (payload?: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
    publish: jest.fn(
      (
        _ex: string,
        _rk: string,
        _content: Buffer,
        options: { messageId?: string },
        cb: (error: unknown) => void,
      ) => {
        if (opts.unroutable) {
          for (const fn of listeners.get('return') ?? []) {
            fn({ properties: { messageId: options.messageId } });
          }
        }
        if (opts.nack) {
          cb(new Error('basic.nack'));
          return true;
        }
        if (opts.confirm !== false) cb(null);
        return true;
      },
    ),
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

function message(
  eventId: string,
  eventType = 'test.a',
  headers: Record<string, unknown> = {},
): ConsumeMessage {
  return {
    content: Buffer.from(
      JSON.stringify({
        id: '1',
        eventId,
        aggregateType: 'test',
        aggregateId: 'A',
        eventType,
        payload: {},
        occurredAt: '2026-09-24T12:00:00.000Z',
        actorAccountId: null,
        clientIp: null,
        userAgent: null,
      }),
    ),
    properties: {
      headers,
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
    rabbit: Partial<RabbitConnectionService> = {},
  ) {
    const host = new RabbitConsumerHostService(
      { getOrThrow: () => cfg } as unknown as ConfigService,
      {
        createConfirmChannel: () =>
          Promise.resolve(channel as unknown as ConfirmChannel),
        retire: () => Promise.resolve(),
        ...rabbit,
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
      new MetricsService(),
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

  it('반증: retry/DLQ 재발행 confirm이 상한 안에 오지 않으면 채널 close를 기다리지 않고 커넥션을 버린 뒤 재시작한다 — blocked 소켓에서 close도 매달린다', async () => {
    const channel = fakeChannel({ confirm: false });
    channel.close = jest.fn(() => new Promise<void>(() => undefined)); // blocked — 영영 안 돌아온다
    const retire = jest.fn().mockResolvedValue(undefined);
    const host = build(
      channel,
      () => Promise.reject(new Error('handle 실패')),
      ['A'],
      { retire },
    );
    host.moveConfirmTimeoutMs = 20;

    await host.start();
    channel.deliver('q.A', message('e-1'));
    await new Promise((r) => setTimeout(r, 80));

    expect(retire).toHaveBeenCalledWith('consumer');
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
    // 옮기지 못했으므로 "retry/DLQ로 보냈다"는 경보를 내지 않는다
    expect(alerts.notify).not.toHaveBeenCalled();
    // 재시작이 걸려 소비가 이어진다 — 타임아웃 한 번에 소비가 영영 멈추면 안 된다
    await flush();
    expect(channel.prefetch).toHaveBeenCalledTimes(2);
    expect(host.isConsuming).toBe(true);
    // 종료도 매달린 close에 붙잡히지 않는다(상한)
    host.destroyTimeoutMs = 200;
    const started = Date.now();
    await host.onModuleDestroy();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(DESTROY_TIMEOUT_MS).toBe(10_000);
  });

  // 옮기기 실패 경로 전수 — confirm 뒤에만 ack, 실패면 백오프 뒤 nack(requeue), '보냈다'는 경보 없음
  it.each([
    ['라우팅될 큐가 없어 return이 온다', { unroutable: true }],
    ['confirm이 nack으로 온다', { nack: true }],
  ])(
    '반증: retry 재발행이 실패(%s)하면 원본을 ack하지 않고 백오프 뒤 nack(requeue)한다',
    async (_, extra) => {
      const channel = fakeChannel(extra);
      const host = build(channel, () =>
        Promise.reject(new Error('handle 실패')),
      );

      await host.start();
      channel.deliver('q.A', message('e-1'));
      await new Promise((r) => setTimeout(r, 30));
      expect(channel.nack).not.toHaveBeenCalled(); // 백오프(1초) 전에는 되돌리지 않는다 — prefetch 1 핫루프 방지
      await new Promise((r) => setTimeout(r, 1_100));

      expect(channel.ack).not.toHaveBeenCalled();
      expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
      expect(alerts.notify).not.toHaveBeenCalled();
      expect(host.isConsuming).toBe(true);
      await host.onModuleDestroy();
    },
  );

  it('반증: ack가 던져도(닫힌 채널) 거부가 새어 나가지 않고 경고로 끝난다', async () => {
    const channel = fakeChannel({ ackThrows: true });
    const host = build(channel, () => Promise.resolve());
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await host.start();
    channel.deliver('q.A', message('e-1'));
    const settled = await Promise.allSettled([
      ...(host as unknown as { inFlight: Set<Promise<void>> }).inFlight,
    ]);

    expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('소비 처리 중단'),
    );
    warn.mockRestore();
    await host.onModuleDestroy();
  });

  it('반증: 구독 목록에 없는 event_type(구독을 뺀 뒤 남은 durable 바인딩)은 handle 없이 ack — 재시도·DLQ로 보내지 않는다', async () => {
    const channel = fakeChannel({});
    const handle = jest.fn().mockResolvedValue(undefined);
    const host = build(channel, handle);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await host.start();
    channel.deliver('q.A', message('e-1', 'test.removed'));
    await Promise.all([
      ...(host as unknown as { inFlight: Set<Promise<void>> }).inFlight,
    ]);

    expect(handle).not.toHaveBeenCalled();
    expect(channel.publish).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('옛 바인딩'),
      expect.anything(),
    );
    warn.mockRestore();
    await host.onModuleDestroy();
  });

  it.each([['abc'], ['NaN'], [-1], [1.5], ['Infinity'], [null]])(
    '반증: x-caquick-attempts=%p 는 0으로 보고 재시도 발행엔 1과 숫자 expiration을 쓴다 — NaN이면 상한 비교가 영영 참이 안 되고 expiration "NaN"은 브로커가 거절해 무한 재전달',
    async (header) => {
      const channel = fakeChannel({});
      const host = build(channel, () => Promise.reject(new Error('boom')));
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await host.start();
      channel.deliver(
        'q.A',
        message('e-1', 'test.a', { 'x-caquick-attempts': header }),
      );
      await Promise.all([
        ...(host as unknown as { inFlight: Set<Promise<void>> }).inFlight,
      ]);

      expect(channel.publish).toHaveBeenCalledTimes(1);
      const [, routingKey, , options] = channel.publish.mock
        .calls[0] as unknown as [
        string,
        string,
        Buffer,
        { headers: Record<string, unknown>; expiration?: string },
      ];
      expect(routingKey).toBe('q.A.retry');
      expect(options.headers['x-caquick-attempts']).toBe(1);
      expect(options.expiration).toBe('1000');
      expect(channel.ack).toHaveBeenCalledTimes(1);
      warn.mockRestore();
      await host.onModuleDestroy();
    },
  );

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
