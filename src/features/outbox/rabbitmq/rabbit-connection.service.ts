import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqplib, { type ChannelModel, type ConfirmChannel } from 'amqplib';

import type { RabbitmqConfig } from '@/config/rabbitmq.config';
import { AlertService } from '@/global/alerting';

/** 재연결 백오프 상한 — 브로커가 오래 죽어 있어도 연결 시도가 폭주하지 않게. */
const RECONNECT_MAX_MS = 10_000;
/** 죽은 소켓을 heartbeat로 빨리 알아챈다(기본 60초 → 10초). URL에 명시돼 있으면 그 값을 존중. */
const DEFAULT_HEARTBEAT_SECONDS = 10;

/**
 * amqplib 커넥션 1개를 프로세스가 공유한다. 부팅을 막지 않는다(lazy) — 첫 사용 시 연결하고,
 * 끊기면 다음 사용 때 백오프로 다시 연결한다. 채널은 용도별(발행 confirm·소비)로 호출자가 연다.
 */
@Injectable()
export class RabbitConnectionService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitConnectionService.name);
  private connection: ChannelModel | null = null;
  private connecting: Promise<ChannelModel> | null = null;
  private failures = 0;
  private closed = false;

  constructor(
    private readonly config: ConfigService,
    private readonly alerts: AlertService,
  ) {}

  get isConnected(): boolean {
    return this.connection !== null;
  }

  async getConnection(): Promise<ChannelModel> {
    if (this.closed) throw new Error('RabbitMQ 커넥션이 종료 중이다');
    if (this.connection) return this.connection;
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  /**
   * confirm 채널. 'error' 리스너를 어떤 RPC보다 먼저 단다 — 리스너 없는 채널의 오류(큐 인자 불일치 406 등)는
   * EventEmitter throw로 번져 커넥션 전체(다른 채널까지)를 끊는다.
   */
  async createConfirmChannel(): Promise<ConfirmChannel> {
    const connection = await this.getConnection();
    const channel = await connection.createConfirmChannel();
    channel.on('error', (error: unknown) => {
      this.logger.warn(
        `RabbitMQ 채널 오류: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return channel;
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    const connection = this.connection;
    this.connection = null;
    await connection?.close().catch(() => undefined);
  }

  private async connect(): Promise<ChannelModel> {
    const { url } = this.config.getOrThrow<RabbitmqConfig>('rabbitmq');
    if (this.failures > 0) {
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(500 * 2 ** (this.failures - 1), RECONNECT_MAX_MS),
        ),
      );
    }
    try {
      const connection = await amqplib.connect(withHeartbeat(url));
      connection.on('close', () => {
        if (!this.closed)
          this.logger.warn('RabbitMQ 연결이 닫혔다 — 다음 사용 때 재연결');
        this.connection = null;
      });
      connection.on('error', (error: unknown) => {
        this.logger.warn(
          `RabbitMQ 연결 오류: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      // 브로커 리소스 알람(메모리·디스크) 중엔 발행 confirm이 오지 않는다 — 릴레이가 조용히 멈추기 전에 알린다
      connection.on('blocked', (reason: string) => {
        this.logger.warn(`RabbitMQ가 발행을 막았다(blocked): ${reason}`);
        void this.alerts.notify({
          level: 'error',
          title: 'RabbitMQ blocked — 브로커 리소스 알람',
          key: 'rabbitmq-blocked',
          detail: reason,
        });
      });
      connection.on('unblocked', () => {
        this.logger.log('RabbitMQ blocked 해제');
      });
      this.connection = connection;
      this.failures = 0;
      return connection;
    } catch (error) {
      this.failures += 1;
      throw error;
    }
  }
}

/** amqp URL에 heartbeat가 없으면 기본값을 붙인다. */
export function withHeartbeat(url: string): string {
  if (/[?&]heartbeat=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}heartbeat=${DEFAULT_HEARTBEAT_SECONDS}`;
}
