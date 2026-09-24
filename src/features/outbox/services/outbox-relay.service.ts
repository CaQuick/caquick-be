import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfirmChannel } from 'amqplib';

import { ClockService } from '@/common/providers/clock.service';
import { TimeoutError, withTimeout } from '@/common/utils/with-timeout';
import type { OutboxConfig } from '@/config/outbox.config';
import { retryBackoffMs } from '@/features/outbox/constants/outbox.constants';
import { OutboxConsumerRegistry } from '@/features/outbox/rabbitmq/outbox-consumer-registry.service';
import { RabbitConnectionService } from '@/features/outbox/rabbitmq/rabbit-connection.service';
import {
  assertTopology,
  EVENTS_EXCHANGE,
  toMessage,
} from '@/features/outbox/rabbitmq/topology';
import {
  OutboxRepository,
  type OutboxRow,
} from '@/features/outbox/repositories/outbox.repository';
import type { DispatchSummary } from '@/features/outbox/types/outbox-event.type';
import { AlertService } from '@/global/alerting';

/** confirm 대기 상한. 브로커가 blocked(리소스 알람)면 confirm이 영영 안 온다 — 틱이 조용히 멈추지 않게 끊고 알린다. */
export const RELAY_CONFIRM_TIMEOUT_MS = 30_000;

/** 브로커가 basic.nack으로 거절 — 채널은 멀쩡하다(적재 실패). 채널 예외·타임아웃과 구분해 채널을 버리지 않는다. */
class ConfirmNackError extends Error {}
/** mandatory 발행이 라우팅될 큐를 못 찾아 돌아왔다 — 소비자 큐가 없다. */
class UnroutableError extends Error {}

/**
 * outbox → RabbitMQ 릴레이(worker 전용, P2 E5). 기한이 된 PENDING을 파티션(aggregate) 안 id 순으로 exchange에
 * publisher confirm으로 싣고 PUBLISHED로 표시한다. confirm이 안 오면 표시하지 않는다(다음 틱 재발행 — 소비자가 멱등).
 * 발행 실패는 백오프 재시도, 상한 초과는 FAILED + 경보(사람이 requeue).
 * 라우팅될 큐가 없는 발행(mandatory return)은 confirm이 와도 실패다 — 브로커는 unroutable에도 ack를 준다.
 */
@Injectable()
export class OutboxRelayService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private channel: ConfirmChannel | null = null;
  /** 채널 'return'으로 돌아온 messageId(=event_id). confirm 뒤 여기 있으면 발행 실패로 본다. */
  private readonly returned = new Set<string>();
  /** spec이 줄여 쓴다 */
  confirmTimeoutMs = RELAY_CONFIRM_TIMEOUT_MS;

  constructor(
    private readonly repo: OutboxRepository,
    private readonly clock: ClockService,
    private readonly config: ConfigService,
    private readonly rabbit: RabbitConnectionService,
    private readonly consumers: OutboxConsumerRegistry,
    private readonly alerts: AlertService,
  ) {}

  onApplicationBootstrap(): void {
    const cfg = this.outboxConfig();
    if (!cfg.dispatchEnabled) return;
    this.timer = setInterval(() => void this.tick(), cfg.pollIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<DispatchSummary | null> {
    if (this.running) return null;
    this.running = true;
    try {
      return await this.relayOnce();
    } catch (error) {
      this.logger.error(
        'outbox 릴레이 틱 실패',
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    } finally {
      this.running = false;
    }
  }

  /** 한 틱. 테스트가 폴링 대신 직접 부른다. */
  async relayOnce(): Promise<DispatchSummary> {
    const cfg = this.outboxConfig();
    const due = await this.repo.findDue(this.clock.now(), cfg.batchSize);
    const summary: DispatchSummary = {
      published: 0,
      retried: 0,
      failed: 0,
      deferred: 0,
    };
    if (due.length === 0) return summary;

    const channel = await this.getChannel();
    // 파티션(aggregate) 안은 id 순으로만 나간다 — 앞선 이벤트가 백오프 중이면 뒤는 미룬다
    const blocked = new Set<string>();
    for (const row of due) {
      const key = `${row.aggregate_type} ${row.aggregate_id}`;
      if (blocked.has(key)) {
        summary.deferred += 1;
        continue;
      }
      if (
        await this.repo.hasOlderPending({
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          beforeId: row.id,
        })
      ) {
        blocked.add(key);
        summary.deferred += 1;
        continue;
      }
      const result = await this.publish(channel, row, cfg);
      summary[result] += 1;
      if (result === 'retried') blocked.add(key);
      // 채널이 죽었으면 나머지 행을 죽은 채널로 밀어 attempts만 올리지 않는다 — 다음 틱이 새 채널로 잇는다
      if (this.channel !== channel) {
        summary.deferred += due.length - due.indexOf(row) - 1;
        break;
      }
    }
    return summary;
  }

  private async publish(
    channel: ConfirmChannel,
    row: OutboxRow,
    cfg: OutboxConfig,
  ): Promise<'published' | 'retried' | 'failed'> {
    try {
      this.returned.delete(row.event_id);
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          channel.publish(
            EVENTS_EXCHANGE,
            row.event_type,
            Buffer.from(JSON.stringify(toMessage(row))),
            {
              persistent: true,
              // 라우팅될 큐가 없으면 'return' — 브로커는 그래도 confirm(ack)을 주므로 이 신호가 유일한 증거다
              mandatory: true,
              contentType: 'application/json',
              messageId: row.event_id,
              timestamp: Math.floor(row.occurred_at.getTime() / 1000),
            },
            (error: unknown) =>
              error
                ? reject(
                    new ConfirmNackError(
                      `confirm nack: ${describeError(error)}`,
                    ),
                  )
                : resolve(),
          );
        }),
        this.confirmTimeoutMs,
        `outbox ${row.event_type}#${row.event_id} confirm`,
      );
      if (this.returned.delete(row.event_id)) {
        throw new UnroutableError(
          '라우팅될 큐가 없다(unroutable) — 소비자 큐가 아직 없거나 삭제됐다',
        );
      }
      await this.repo.markPublished(row.id);
      return 'published';
    } catch (error) {
      return this.handlePublishFailure(channel, row, cfg, error);
    }
  }

  private async handlePublishFailure(
    channel: ConfirmChannel,
    row: OutboxRow,
    cfg: OutboxConfig,
    error: unknown,
  ): Promise<'retried' | 'failed'> {
    const detail = error instanceof Error ? error.message : String(error);
    if (error instanceof UnroutableError) {
      void this.alerts.notify({
        level: 'error',
        title: 'outbox 발행 unroutable — 소비자 큐 없음',
        key: `outbox-unroutable:${row.event_type}`,
        detail: `${row.event_type}#${row.event_id}: ${detail}`,
      });
    } else if (!(error instanceof ConfirmNackError)) {
      // 채널 예외(닫힘 등)·confirm 타임아웃 — 채널을 버리고 이 틱의 나머지 행은 다음 틱(새 채널)에 맡긴다
      this.discardChannel(channel);
      if (error instanceof TimeoutError) {
        void this.alerts.notify({
          level: 'error',
          title: 'outbox 릴레이 정체 — confirm 타임아웃',
          key: 'outbox-relay-stalled',
          detail: `${row.event_type}#${row.event_id}: ${detail}`,
        });
      }
    }
    const attempts = row.attempts + 1;
    if (attempts >= cfg.maxAttempts) {
      await this.repo.markFailed(row.id);
      this.logger.error(
        `outbox ${row.event_type}#${row.event_id} 발행 ${attempts}회 실패 — FAILED로 남김`,
        { eventId: row.event_id, eventType: row.event_type, attempts, detail },
      );
      void this.alerts.notify({
        level: 'error',
        title: 'outbox FAILED',
        key: `outbox-failed:${row.event_type}`,
        detail: `${row.event_type}#${row.event_id} 발행 ${attempts}회 실패: ${detail} — 원인 해소 뒤 yarn outbox:requeue --id=${row.id.toString()}`,
      });
      return 'failed';
    }
    const delay = retryBackoffMs(attempts);
    await this.repo.markRetry(
      row.id,
      new Date(this.clock.now().getTime() + delay),
    );
    this.logger.warn(
      `outbox ${row.event_type}#${row.event_id} 발행 ${attempts}회 실패 — ${delay}ms 뒤 재시도`,
      { eventId: row.event_id, eventType: row.event_type, attempts, detail },
    );
    return 'retried';
  }

  private discardChannel(channel: ConfirmChannel): void {
    if (this.channel === channel) this.channel = null;
    void channel.close().catch(() => undefined);
  }

  private async getChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    const channel = await this.rabbit.createConfirmChannel();
    // 소비자 호스트와 같은 토폴로지를 선언한다 — 릴레이가 먼저 붙어도 큐 없는 exchange에 싣지 않게
    await assertTopology(channel, this.consumers.resolve());
    channel.on('return', (message: { properties: { messageId?: string } }) => {
      const id = message.properties.messageId;
      if (id) this.returned.add(id);
    });
    channel.on('close', () => {
      if (this.channel === channel) this.channel = null;
    });
    this.channel = channel;
    return channel;
  }

  private outboxConfig(): OutboxConfig {
    return this.config.getOrThrow<OutboxConfig>('outbox');
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}
