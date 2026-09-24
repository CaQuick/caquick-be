import { randomUUID } from 'node:crypto';

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';

import { TimeoutError, withTimeout } from '@/common/utils/with-timeout';
import type { OutboxConfig } from '@/config/outbox.config';
import { retryBackoffMs } from '@/features/outbox/constants/outbox.constants';
import {
  OutboxConsumerRegistry,
  type RegisteredConsumer,
} from '@/features/outbox/rabbitmq/outbox-consumer-registry.service';
import { RabbitConnectionService } from '@/features/outbox/rabbitmq/rabbit-connection.service';
import {
  assertTopology,
  ATTEMPTS_HEADER,
  DLQ_EXCHANGE,
  isPermanentBrokerError,
  parseMessage,
  toEvent,
} from '@/features/outbox/rabbitmq/topology';
import { AlertService } from '@/global/alerting';
import { MetricsService } from '@/global/metrics';
import { RequestContextService } from '@/global/request-context';

/** 시작 실패가 이만큼 이어지면 경보 — 브로커 부재가 아니라 설정 문제일 수 있다. */
const START_FAILURES_BEFORE_ALERT = 5;
/** 종료 시 cancel·in-flight·close를 기다리는 상한 — 그 뒤엔 브로커 재전달에 맡기고 내려간다. */
export const DESTROY_TIMEOUT_MS = 10_000;
/** 옮기기 실패 뒤 nack(requeue) 전 대기 상한 — 종료 대기(10초)보다 짧게. */
const NACK_BACKOFF_MAX_MS = 5_000;
/** retry/DLQ 재발행 confirm 대기 상한. 브로커가 blocked면 confirm이 안 와 prefetch 1 소비자가 영영 멈춘다 — 채널을 버려 재시작한다. */
export const MOVE_CONFIRM_TIMEOUT_MS = 30_000;

/**
 * RabbitMQ 소비자 호스트(worker 전용, P2 E4). `@SubscribeOutbox` provider마다 durable 큐 1개를 만들어
 * event_type으로 exchange에 바인딩하고 prefetch 1로 소비한다. 실패는 retry 큐(per-message TTL, 만료 시 본 큐로
 * 복귀)로 백오프, 상한 초과는 DLQ + 경보. 전달은 at-least-once — 소비자는 멱등이어야 한다(계약).
 * 순서는 큐 FIFO다. 재시도로 뒤바뀔 수 있으므로 순서 민감 소비자는 원본 시각(watermark)으로 옛 이벤트를 버린다.
 * 채널이 죽으면 unack 메시지는 브로커가 재전달한다 — 그래서 ack·재발행 실패는 던지지 않고 물러난다.
 */
@Injectable()
export class RabbitConsumerHostService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RabbitConsumerHostService.name);
  private channel: ConfirmChannel | null = null;
  private consumerTags: string[] = [];
  private readonly inFlight = new Set<Promise<void>>();
  private readonly returned = new Set<string>();
  private stopped = false;
  private startFailures = 0;
  /** start()가 도는 동안 — 이때 채널이 닫히면 start()의 throw가 재시도 루프로 이어지므로 close 리스너는 재시작하지 않는다 */
  private starting = false;
  /** 재시작 루프는 한 번에 하나만 — close 리스너·타임아웃 경로가 겹쳐도 소비 채널이 둘이 되지 않게 */
  private restartLoop: Promise<void> | null = null;
  /** 재연결 백오프 sleep — 종료 시 깨워서 프로세스가 타이머에 붙잡히지 않게 */
  private wakeRetry: (() => void) | null = null;
  /** spec이 줄여 쓴다 */
  moveConfirmTimeoutMs = MOVE_CONFIRM_TIMEOUT_MS;
  destroyTimeoutMs = DESTROY_TIMEOUT_MS;

  constructor(
    private readonly config: ConfigService,
    private readonly rabbit: RabbitConnectionService,
    private readonly consumers: OutboxConsumerRegistry,
    private readonly alerts: AlertService,
    private readonly requestContext: RequestContextService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.getOrThrow<OutboxConfig>('outbox').dispatchEnabled) return;
    // 배선 오류(handle 없는 소비자)는 여기서 던져 부팅을 막는다 — 재연결 루프 안에서 삼키면 브로커 부재처럼 보인다
    this.consumers.resolve();
    // 브로커가 아직 없으면 부팅을 막지 않고 백그라운드에서 붙는다
    void this.startWithRetry();
  }

  /**
   * 소비 중단 → 진행 중 handle 완료 → 채널 close. 순서가 바뀌면 in-flight의 ack가 닫힌 채널에 던진다.
   * 브로커가 blocked면 cancel·close가 매달리므로 전체에 상한을 둔다 — 종료 유예를 다 쓰지 않게.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.wakeRetry?.();
    const channel = this.channel;
    const graceful = async (): Promise<void> => {
      if (channel) {
        for (const tag of this.consumerTags) {
          await channel.cancel(tag).catch(() => undefined);
        }
      }
      this.consumerTags = [];
      // 진행 중 handle의 ack가 나가야 하므로 this.channel은 드레인이 끝난 뒤에 비운다 — 먼저 비우면 가드가 ack를 막아 재시작마다 중복 전달
      await Promise.allSettled([...this.inFlight]);
      if (this.channel === channel) this.channel = null;
      await channel?.close().catch(() => undefined);
    };
    await withTimeout(graceful(), this.destroyTimeoutMs, '소비자 종료').catch(
      (error: unknown) =>
        this.logger.warn(
          `소비자 정상 종료를 기다리지 않는다: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
  }

  get isConsuming(): boolean {
    return this.channel !== null;
  }

  /** 테스트·재연결이 직접 부른다. 큐·바인딩을 만들고 소비를 시작한다. */
  async start(): Promise<void> {
    this.starting = true;
    try {
      await this.startChannel();
    } finally {
      this.starting = false;
    }
  }

  private async startChannel(): Promise<void> {
    const consumers = this.consumers.resolve();
    const channel = await this.rabbit.createConfirmChannel();
    // 리스너를 RPC보다 먼저 — assertTopology가 406으로 거절되면 리스너 없는 채널은 커넥션까지 끊는다
    channel.on('close', () => {
      if (this.channel !== channel) return;
      this.channel = null;
      this.consumerTags = [];
      // start() 도중이면 start()가 던져 재시도 루프가 잇는다 — 여기서도 재시작하면 소비 채널이 둘이 된다
      if (!this.stopped && !this.starting) void this.startWithRetry();
    });
    channel.on('return', (message: { properties: { messageId?: string } }) => {
      const id = message.properties.messageId;
      if (id) this.returned.add(id);
    });
    await assertTopology(channel, consumers);
    await channel.prefetch(1);
    // consume을 거는 순간부터 밀린 메시지가 올 수 있다 — 채널을 먼저 활성으로 둬야 그 ack가 "닫힌 채널"로 오인되지 않는다
    this.channel = channel;
    const tags: string[] = [];
    try {
      for (const consumer of consumers) {
        const { consumerTag } = await channel.consume(
          consumer.queues.main,
          (message) => {
            if (!message) {
              // 큐 삭제(consumer cancel) — 브로커가 소비를 끊었다. 채널을 닫아 재시작 경로를 태운다
              this.logger.warn(
                `${consumer.name} 큐 ${consumer.queues.main}의 소비가 브로커에서 취소됐다 — 재시작`,
              );
              void channel.close().catch(() => undefined);
              return;
            }
            const task = this.handle(channel, consumer, message).catch(
              (error: unknown) => {
                // 채널이 닫힌 뒤의 ack·재발행 실패 등 — 던지면 unhandled rejection으로 프로세스가 죽는다
                this.logger.warn(
                  `${consumer.name} 소비 처리 중단(브로커가 재전달한다): ${error instanceof Error ? error.message : String(error)}`,
                );
              },
            );
            this.inFlight.add(task);
            void task.finally(() => this.inFlight.delete(task));
          },
        );
        tags.push(consumerTag);
      }
    } catch (error) {
      // 뒤쪽 큐의 consume이 실패하면 앞쪽은 이미 소비 중 — 채널을 닫아 전부 되돌리고 재시도로 넘긴다
      if (this.channel === channel) this.channel = null;
      await channel.close().catch(() => undefined);
      throw error;
    }
    if (this.stopped) {
      // 종료가 start() 도중에 시작됐다 — 방금 건 소비를 걷어 종료 뒤 채널이 남지 않게
      if (this.channel === channel) this.channel = null;
      await channel.close().catch(() => undefined);
      return;
    }
    this.consumerTags = tags;
    this.startFailures = 0;
    this.logger.log(
      `RabbitMQ 소비 시작 — ${consumers.map((c) => `${c.name}[${c.eventTypes.join(',')}]`).join(' ')}`,
    );
  }

  private startWithRetry(): Promise<void> {
    if (!this.restartLoop) {
      this.restartLoop = this.retryLoop().finally(() => {
        this.restartLoop = null;
      });
    }
    return this.restartLoop;
  }

  private async retryLoop(): Promise<void> {
    let delay = 1_000;
    while (!this.stopped) {
      try {
        await this.start();
        return;
      } catch (error) {
        this.startFailures += 1;
        const detail = error instanceof Error ? error.message : String(error);
        const permanent = isPermanentBrokerError(error);
        this.logger.warn(
          `RabbitMQ 소비 시작 실패(${this.startFailures}회) — ${delay}ms 뒤 재시도: ${detail}`,
        );
        // 큐 인자 불일치(406)·권한(403)은 재시도로 풀리지 않는다 — 바로 알린다. 그 밖은 연속 실패가 쌓이면
        if (permanent || this.startFailures === START_FAILURES_BEFORE_ALERT) {
          void this.alerts.notify({
            level: 'error',
            title: permanent
              ? 'RabbitMQ 토폴로지 선언 거절 — 소비가 시작되지 않는다'
              : 'RabbitMQ 소비 시작 실패가 이어진다',
            key: `outbox-consumer-start:${permanent ? 'permanent' : 'repeated'}`,
            detail,
          });
        }
        await this.sleep(delay);
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }

  /** 취소 가능한 sleep — onModuleDestroy가 깨운다. 타이머는 unref라 종료를 붙잡지 않는다. */
  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wakeRetry = null;
        resolve();
      }, ms);
      timer.unref();
      this.wakeRetry = () => {
        clearTimeout(timer);
        this.wakeRetry = null;
        resolve();
      };
    });
  }

  private async handle(
    channel: ConfirmChannel,
    consumer: RegisteredConsumer,
    message: ConsumeMessage,
  ): Promise<void> {
    const attempts = readAttempts(message.properties.headers);
    const cfg = this.config.getOrThrow<OutboxConfig>('outbox');
    // 관측은 파싱 전에 시작 — 깨진 본문의 DLQ 이동도 result=dlq로 세야 대시보드가 DLQ 사건을 놓치지 않는다
    const startedAt = performance.now();
    const observe = (result: 'ok' | 'retry' | 'dlq') =>
      this.metrics.outboxConsumeDuration.observe(
        { consumer: consumer.name, result },
        (performance.now() - startedAt) / 1000,
      );
    let parsed;
    try {
      parsed = parseMessage(message.content);
    } catch (error) {
      // 깨진 본문은 재시도해도 고쳐지지 않는다 — 바로 DLQ
      const detail = error instanceof Error ? error.message : String(error);
      const moved = await this.moveThenAck(
        channel,
        message,
        DLQ_EXCHANGE,
        consumer.queues.dlq,
        attempts,
      );
      if (!moved) return; // 옮기지 못했다 — 원본이 requeue/재전달되므로 DLQ라고 알리지 않는다
      observe('dlq');
      this.logger.error(`${consumer.name} 본문 파싱 실패 — DLQ`, { detail });
      void this.alerts.notify({
        level: 'error',
        title: 'outbox 소비 DLQ',
        key: `outbox-dlq:${consumer.name}`,
        detail: `${consumer.name} 본문 파싱 실패: ${detail} — 큐 ${consumer.queues.dlq}에 남김`,
      });
      return;
    }
    const label = `${consumer.name} ${parsed.eventType}#${parsed.eventId}`;
    if (!consumer.eventTypes.includes(parsed.eventType)) {
      // 구독에서 뺀 event_type의 durable 바인딩은 브로커에 남고 AMQP로는 열거할 수 없다 — 처리하지 않고 버린다(재시도·DLQ면 경보만 는다)
      this.logger.warn(`${label} 구독하지 않는 event_type — 버림(옛 바인딩)`, {
        eventId: parsed.eventId,
      });
      this.ack(channel, message);
      return;
    }
    try {
      // 소비 중 모든 로그 줄에 eventId — 발행 로그(requestId+eventId)와 이어 보는 열쇠(P2 E8)
      await this.requestContext.run({ eventId: parsed.eventId }, () =>
        consumer.instance.handle(toEvent(parsed, attempts)),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const next = attempts + 1;
      if (next >= cfg.maxAttempts) {
        const moved = await this.moveThenAck(
          channel,
          message,
          DLQ_EXCHANGE,
          consumer.queues.dlq,
          next,
        );
        if (!moved) return;
        observe('dlq');
        this.logger.error(`${label} 소비 ${next}회 실패 — DLQ`, {
          eventId: parsed.eventId,
          attempts: next,
          detail,
        });
        void this.alerts.notify({
          level: 'error',
          title: 'outbox 소비 DLQ',
          key: `outbox-dlq:${consumer.name}`,
          detail: `${label} ${next}회 실패: ${detail} — 큐 ${consumer.queues.dlq}. 재처리: 원인 해소 뒤 yarn outbox:requeue --event-id=${parsed.eventId} --republish`,
        });
        return;
      }
      const delay = retryBackoffMs(next);
      const moved = await this.moveThenAck(
        channel,
        message,
        '',
        consumer.queues.retry,
        next,
        delay,
      );
      if (!moved) return;
      observe('retry');
      this.logger.warn(`${label} 소비 ${next}회 실패 — ${delay}ms 뒤 재시도`, {
        eventId: parsed.eventId,
        attempts: next,
        detail,
      });
      return;
    }
    this.ack(channel, message);
    observe('ok');
  }

  /** 채널이 이미 닫혔으면 ack는 던진다 — 브로커가 unack 메시지를 재전달하므로 조용히 물러난다. */
  private ack(channel: ConfirmChannel, message: ConsumeMessage): void {
    if (this.channel !== channel) return;
    channel.ack(message);
  }

  /**
   * 본문·속성을 유지한 채 다른 큐로 옮긴 **뒤** 원본을 ack한다. 옮기는 발행은 confirm과 mandatory로 확인한다 —
   * 확인 없이 ack하면 사본이 사라졌을 때 원본도 이미 없다. 실패하면 nack(requeue)해 브로커 재전달에 맡기고 false —
   * 호출자는 그때 "옮겼다"고 기록·경보하지 않는다.
   */
  private async moveThenAck(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    exchange: string,
    routingKey: string,
    attempts: number,
    expirationMs?: number,
  ): Promise<boolean> {
    if (this.channel !== channel) return false;
    // return을 messageId로 식별한다 — 없는 메시지는 부여해서라도 unroutable을 놓치지 않는다
    const rawId: unknown = message.properties.messageId;
    const messageId = typeof rawId === 'string' ? rawId : randomUUID();
    this.returned.delete(messageId);
    try {
      await withTimeout(
        withConfirm((cb) =>
          channel.publish(
            exchange,
            routingKey,
            message.content,
            {
              ...message.properties,
              messageId,
              mandatory: true,
              headers: {
                ...message.properties.headers,
                [ATTEMPTS_HEADER]: attempts,
              },
              ...(expirationMs === undefined
                ? {}
                : { expiration: String(expirationMs) }),
            },
            cb,
          ),
        ),
        this.moveConfirmTimeoutMs,
        `${routingKey} 재발행 confirm`,
      );
      if (this.returned.delete(messageId)) {
        throw new Error(`${routingKey} 큐가 없다(unroutable)`);
      }
      channel.ack(message);
      return true;
    } catch (error) {
      this.logger.warn(
        `${routingKey}로 옮기지 못했다 — 원본을 requeue: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (error instanceof TimeoutError) {
        // confirm이 안 오면 커넥션이 blocked일 수 있다 — close 핸드셰이크도 같은 소켓에서 매달리므로 기다리지 않는다.
        // 채널을 즉시 죽은 것으로 보고 커넥션째 버린 뒤 재시작한다(unack는 브로커가 재전달). 'close' 리스너는 identity가 달라 중복 재시작하지 않는다
        if (this.channel === channel) {
          this.channel = null;
          this.consumerTags = [];
          void this.rabbit.retire('consumer').then(() => {
            if (!this.stopped) void this.startWithRetry();
          });
        }
        return false;
      }
      // prefetch 1에서 바로 nack하면 같은 메시지가 즉시 다시 와 핫 루프가 된다 — 재시도 백오프만큼 쉬고 되돌린다
      await this.sleep(Math.min(retryBackoffMs(attempts), NACK_BACKOFF_MAX_MS));
      if (this.channel === channel) channel.nack(message, false, true);
      return false;
    }
  }
}

/**
 * 손으로 발행·shovel된 메시지의 헤더는 믿지 않는다 — 음이 아닌 정수가 아니면 0(첫 시도)으로 본다. NaN이면 상한 비교가
 * 영영 참이 되지 않고 expiration "NaN"은 브로커가 거절해 같은 메시지가 무한 재전달돼 prefetch 1 소비자가 막힌다.
 */
export function readAttempts(
  headers: ConsumeMessage['properties']['headers'],
): number {
  const raw: unknown = headers?.[ATTEMPTS_HEADER];
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

function withConfirm(
  publish: (cb: (error: unknown) => void) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    publish((error) =>
      error
        ? reject(
            error instanceof Error ? error : new Error('publish confirm 실패'),
          )
        : resolve(),
    );
  });
}
