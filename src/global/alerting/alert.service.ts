import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClockService } from '@/common/providers/clock.service';
import type { AlertingConfig } from '@/config/alerting.config';
import { resolveAppRole } from '@/config/app.config';
import {
  ALERT_TRANSPORT,
  type AlertMessage,
  type AlertTransport,
} from '@/global/alerting/discord-webhook';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';

export type AlertOutcome = 'sent' | 'suppressed' | 'skipped' | 'failed';

/**
 * 운영 경보의 단일 출구. 절대 던지지 않고 결과만 돌려준다 — 경보 때문에 본 작업이 실패하면 안 된다.
 * 웹훅이 없으면 로그로만 남기고, 같은 key는 억제 창 안에서 한 번만 보낸다.
 */
@Injectable()
export class AlertService {
  private readonly lastSentAt = new Map<string, number>();

  constructor(
    private readonly config: ConfigService,
    private readonly clock: ClockService,
    private readonly logger: CustomLoggerService,
    @Inject(ALERT_TRANSPORT) private readonly transport: AlertTransport,
  ) {}

  async notify(message: AlertMessage): Promise<AlertOutcome> {
    const { discordWebhookUrl, dedupeWindowMs } =
      this.config.getOrThrow<AlertingConfig>('alerting');
    const key = message.key ?? message.title;
    const now = this.clock.nowMs();
    const last = this.lastSentAt.get(key);
    if (last !== undefined && now - last < dedupeWindowMs) return 'suppressed';

    // 억제 기준은 "보내려 한 시각" — 전송 실패가 폭주로 이어지지 않게 한다
    this.lastSentAt.set(key, now);
    const line = `[alert:${message.level}] ${message.title}`;
    if (!discordWebhookUrl) {
      this.logger.warn(line, { detail: message.detail, delivered: false });
      return 'skipped';
    }
    const ok = await this.transport(discordWebhookUrl, message, {
      role: resolveAppRole(),
      env: process.env.NODE_ENV ?? 'development',
    });
    if (!ok) {
      this.logger.warn(`${line} — Discord 전송 실패`, {
        detail: message.detail,
      });
      return 'failed';
    }
    return 'sent';
  }
}
