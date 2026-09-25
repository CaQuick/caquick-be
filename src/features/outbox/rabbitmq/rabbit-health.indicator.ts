import { Injectable } from '@nestjs/common';
import type { ConfirmChannel } from 'amqplib';

import {
  HEALTH_CHECK_TIMEOUT_MS,
  type HealthIndicator,
} from '@/common/ports/health-indicator.port';
import { withTimeout } from '@/common/utils/with-timeout';
import { RabbitConnectionService } from '@/features/outbox/rabbitmq/rabbit-connection.service';
import { EVENTS_EXCHANGE } from '@/features/outbox/rabbitmq/topology';

/**
 * worker의 ready에만 들어간다 — api는 outbox 테이블에만 쓰므로 브로커가 없어도 요청을 받을 수 있다.
 * 커넥션 객체가 있다는 것만으로는 죽은 소켓을 heartbeat 시간까지 up으로 본다 — 왕복 RPC 1회로 확인한다.
 */
@Injectable()
export class RabbitHealthIndicator implements HealthIndicator {
  readonly name = 'rabbitmq';
  private channel: ConfirmChannel | null = null;

  constructor(private readonly rabbit: RabbitConnectionService) {}

  async check(): Promise<void> {
    await withTimeout(this.ping(), HEALTH_CHECK_TIMEOUT_MS, 'rabbitmq ping');
  }

  private async ping(): Promise<void> {
    try {
      const channel = await this.getChannel();
      await channel.checkExchange(EVENTS_EXCHANGE);
    } catch (error) {
      // 채널이 죽었으면 다음 검사는 새 채널로
      this.channel = null;
      throw error;
    }
  }

  private async getChannel(): Promise<ConfirmChannel> {
    if (this.channel) return this.channel;
    const channel = await this.rabbit.createConfirmChannel();
    channel.on('close', () => {
      this.channel = null;
    });
    this.channel = channel;
    return channel;
  }
}
