import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqplib, { type ChannelModel, type ConfirmChannel } from 'amqplib';

import type { RabbitmqConfig } from '@/config/rabbitmq.config';
import { AlertService } from '@/global/alerting';

/** 재연결 백오프 상한 — 브로커가 오래 죽어 있어도 연결 시도가 폭주하지 않게. */
const RECONNECT_MAX_MS = 10_000;
/** 죽은 소켓을 heartbeat로 빨리 알아챈다(기본 60초 → 10초). URL에 명시돼 있으면 그 값을 존중. */
const DEFAULT_HEARTBEAT_SECONDS = 10;

/** 발행과 소비는 커넥션을 나눈다 — 브로커 리소스 알람은 발행한 커넥션을 통째로 막는데(blocked), 같은 소켓이면 소비 ack까지 멈춘다. */
export type RabbitConnectionKind = 'publisher' | 'consumer';

interface ConnectionSlot {
  connection: ChannelModel | null;
  connecting: Promise<ChannelModel> | null;
  failures: number;
}

/**
 * amqplib 커넥션을 용도별(발행·소비) 1개씩 프로세스가 공유한다. 부팅을 막지 않는다(lazy) — 첫 사용 시 연결하고,
 * 끊기면 다음 사용 때 백오프로 다시 연결한다. 채널은 호출자가 연다.
 */
@Injectable()
export class RabbitConnectionService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitConnectionService.name);
  private readonly slots: Record<RabbitConnectionKind, ConnectionSlot> = {
    publisher: { connection: null, connecting: null, failures: 0 },
    consumer: { connection: null, connecting: null, failures: 0 },
  };
  private closed = false;

  constructor(
    private readonly config: ConfigService,
    private readonly alerts: AlertService,
  ) {}

  isConnected(kind: RabbitConnectionKind = 'consumer'): boolean {
    return this.slots[kind].connection !== null;
  }

  async getConnection(
    kind: RabbitConnectionKind = 'consumer',
  ): Promise<ChannelModel> {
    if (this.closed) throw new Error('RabbitMQ 커넥션이 종료 중이다');
    const slot = this.slots[kind];
    if (slot.connection) return slot.connection;
    if (!slot.connecting) {
      slot.connecting = this.connect(kind).finally(() => {
        slot.connecting = null;
      });
    }
    return slot.connecting;
  }

  /**
   * confirm 채널. 'error' 리스너를 어떤 RPC보다 먼저 단다 — 리스너 없는 채널의 오류(큐 인자 불일치 406 등)는
   * EventEmitter throw로 번져 커넥션 전체(다른 채널까지)를 끊는다.
   */
  async createConfirmChannel(
    kind: RabbitConnectionKind = 'consumer',
  ): Promise<ConfirmChannel> {
    const connection = await this.getConnection(kind);
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
    for (const slot of Object.values(this.slots)) {
      const connection = slot.connection;
      slot.connection = null;
      await connection?.close().catch(() => undefined);
    }
  }

  private async connect(kind: RabbitConnectionKind): Promise<ChannelModel> {
    const slot = this.slots[kind];
    const { url } = this.config.getOrThrow<RabbitmqConfig>('rabbitmq');
    if (slot.failures > 0) {
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(500 * 2 ** (slot.failures - 1), RECONNECT_MAX_MS),
        ),
      );
    }
    try {
      const connection = await amqplib.connect(withHeartbeat(url), {
        clientProperties: { connection_name: `caquick-${kind}` },
      });
      if (this.closed) {
        // 종료가 먼저 시작됐다 — 늦게 열린 소켓이 프로세스를 붙잡거나 종료 뒤 채널을 열지 않게
        await connection.close().catch(() => undefined);
        throw new Error('RabbitMQ 커넥션이 종료 중이다');
      }
      connection.on('close', () => {
        if (!this.closed)
          this.logger.warn(
            `RabbitMQ ${kind} 연결이 닫혔다 — 다음 사용 때 재연결`,
          );
        if (slot.connection === connection) slot.connection = null;
      });
      connection.on('error', (error: unknown) => {
        this.logger.warn(
          `RabbitMQ 연결 오류: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      // 브로커 리소스 알람(메모리·디스크) 중엔 발행 confirm이 오지 않는다 — 릴레이가 조용히 멈추기 전에 알린다
      connection.on('blocked', (reason: string) => {
        this.logger.warn(
          `RabbitMQ가 ${kind} 연결의 발행을 막았다(blocked): ${reason}`,
        );
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
      slot.connection = connection;
      slot.failures = 0;
      return connection;
    } catch (error) {
      slot.failures += 1;
      throw error;
    }
  }
}

/** amqp URL에 heartbeat가 없으면 기본값을 붙인다. */
export function withHeartbeat(url: string): string {
  if (/[?&]heartbeat=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}heartbeat=${DEFAULT_HEARTBEAT_SECONDS}`;
}
