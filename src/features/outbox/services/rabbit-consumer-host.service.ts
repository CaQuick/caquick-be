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
import { RequestContextService } from '@/global/request-context';

/** 시작 실패가 이만큼 이어지면 경보 — 브로커 부재가 아니라 설정 문제일 수 있다. */
const START_FAILURES_BEFORE_ALERT = 5;
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
  /** spec이 줄여 쓴다 */
  moveConfirmTimeoutMs = MOVE_CONFIRM_TIMEOUT_MS;

  constructor(
    private readonly config: ConfigService,
    private readonly rabbit: RabbitConnectionService,
    private readonly consumers: OutboxConsumerRegistry,
    private readonly alerts: AlertService,
    private readonly requestContext: RequestContextService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.getOrThrow<OutboxConfig>('outbox').dispatchEnabled) return;
    // 배선 오류(handle 없는 소비자)는 여기서 던져 부팅을 막는다 — 재연결 루프 안에서 삼키면 브로커 부재처럼 보인다
    this.consumers.resolve();
    // 브로커가 아직 없으면 부팅을 막지 않고 백그라운드에서 붙는다
    void this.startWithRetry();
  }

  /** 소비 중단 → 진행 중 handle 완료 → 채널 close. 순서가 바뀌면 in-flight의 ack가 닫힌 채널에 던진다. */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      for (const tag of this.consumerTags) {
        await channel.cancel(tag).catch(() => undefined);
      }
    }
    this.consumerTags = [];
    await Promise.allSettled([...this.inFlight]);
    await channel?.close().catch(() => undefined);
  }

  get isConsuming(): boolean {
    return this.channel !== null;
  }

  /** 테스트·재연결이 직접 부른다. 큐·바인딩을 만들고 소비를 시작한다. */
  async start(): Promise<void> {
    const consumers = this.consumers.resolve();
    const channel = await this.rabbit.createConfirmChannel();
    // 리스너를 RPC보다 먼저 — assertTopology가 406으로 거절되면 리스너 없는 채널은 커넥션까지 끊는다
    channel.on('close', () => {
      if (this.channel !== channel) return;
      this.channel = null;
      this.consumerTags = [];
      if (!this.stopped) void this.startWithRetry();
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
    this.consumerTags = tags;
    this.startFailures = 0;
    this.logger.log(
      `RabbitMQ 소비 시작 — ${consumers.map((c) => `${c.name}[${c.eventTypes.join(',')}]`).join(' ')}`,
    );
  }

  private async startWithRetry(): Promise<void> {
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
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }

  private async handle(
    channel: ConfirmChannel,
    consumer: RegisteredConsumer,
    message: ConsumeMessage,
  ): Promise<void> {
    const attempts = Number(message.properties.headers?.[ATTEMPTS_HEADER] ?? 0);
    const cfg = this.config.getOrThrow<OutboxConfig>('outbox');
    let parsed;
    try {
      parsed = parseMessage(message.content);
    } catch (error) {
      // 깨진 본문은 재시도해도 고쳐지지 않는다 — 바로 DLQ
      const detail = error instanceof Error ? error.message : String(error);
      await this.moveThenAck(
        channel,
        message,
        DLQ_EXCHANGE,
        consumer.queues.dlq,
        attempts,
      );
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
    try {
      // 소비 중 모든 로그 줄에 eventId — 발행 로그(requestId+eventId)와 이어 보는 열쇠(P2 E8)
      await this.requestContext.run({ eventId: parsed.eventId }, () =>
        consumer.instance.handle(toEvent(parsed, attempts)),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const next = attempts + 1;
      if (next >= cfg.maxAttempts) {
        await this.moveThenAck(
          channel,
          message,
          DLQ_EXCHANGE,
          consumer.queues.dlq,
          next,
        );
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
      await this.moveThenAck(
        channel,
        message,
        '',
        consumer.queues.retry,
        next,
        delay,
      );
      this.logger.warn(`${label} 소비 ${next}회 실패 — ${delay}ms 뒤 재시도`, {
        eventId: parsed.eventId,
        attempts: next,
        detail,
      });
      return;
    }
    this.ack(channel, message);
  }

  /** 채널이 이미 닫혔으면 ack는 던진다 — 브로커가 unack 메시지를 재전달하므로 조용히 물러난다. */
  private ack(channel: ConfirmChannel, message: ConsumeMessage): void {
    if (this.channel !== channel) return;
    channel.ack(message);
  }

  /**
   * 본문·속성을 유지한 채 다른 큐로 옮긴 **뒤** 원본을 ack한다. 옮기는 발행은 confirm과 mandatory로 확인한다 —
   * 확인 없이 ack하면 사본이 사라졌을 때 원본도 이미 없다. 실패하면 nack(requeue)해 브로커 재전달에 맡긴다.
   */
  private async moveThenAck(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    exchange: string,
    routingKey: string,
    attempts: number,
    expirationMs?: number,
  ): Promise<void> {
    if (this.channel !== channel) return;
    const rawId: unknown = message.properties.messageId;
    const messageId = typeof rawId === 'string' ? rawId : undefined;
    if (messageId) this.returned.delete(messageId);
    try {
      await withTimeout(
        withConfirm((cb) =>
          channel.publish(
            exchange,
            routingKey,
            message.content,
            {
              ...message.properties,
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
      if (messageId && this.returned.delete(messageId)) {
        throw new Error(`${routingKey} 큐가 없다(unroutable)`);
      }
      channel.ack(message);
    } catch (error) {
      this.logger.warn(
        `${routingKey}로 옮기지 못했다 — 원본을 requeue: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (error instanceof TimeoutError) {
        // confirm이 안 오는 채널은 믿을 수 없다 — 닫아서 unack를 브로커가 재전달하게 하고 재시작한다
        if (this.channel === channel) this.channel = null;
        await channel.close().catch(() => undefined);
        return;
      }
      if (this.channel === channel) channel.nack(message, false, true);
    }
  }
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
