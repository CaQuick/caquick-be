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

/** 전송 실패 뒤 1회 재전송까지의 간격. 호출자를 막지 않으려 타이머로 뒤에 보낸다. */
export const ALERT_RETRY_DELAY_MS = 5_000;

/**
 * 운영 경보·업무 알림의 단일 출구. 절대 던지지 않고 결과만 돌려준다 — 경보 때문에 본 작업이 실패하면 안 된다.
 * 웹훅이 없으면 로그로만 남기고, 같은 key는 억제 창 안에서 한 번만 보낸다.
 */
@Injectable()
export class AlertService {
  private readonly lastSentAt = new Map<string, number>();
  /**
   * key별 진행 중인 마지막 전송 시도 번호(전송·재전송이 끝나면 지운다). 억제 창 정리와 따로 두어,
   * 정리나 겹친 전송이 이미 더 새 시도로 대체된 경보의 재전송을 되살리지 않게 한다
   */
  private readonly latestAttempt = new Map<string, number>();
  private attemptSeq = 0;

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
    this.forgetExpired(now, dedupeWindowMs);
    const last = this.lastSentAt.get(key);
    if (last !== undefined && now - last < dedupeWindowMs) return 'suppressed';

    // 억제 기준은 "보내려 한 시각" — 전송 실패가 폭주로 이어지지 않게 한다
    this.lastSentAt.set(key, now);
    const line = `[alert:${message.level}] ${message.title}`;
    if (!discordWebhookUrl) {
      const log = message.level === 'info' ? 'log' : 'warn';
      this.logger[log](line, { detail: message.detail, delivered: false });
      return 'skipped';
    }
    const origin = {
      role: resolveAppRole(),
      env: process.env.NODE_ENV ?? 'development',
    };
    // 같은 key의 새 시도가 묵은 시도의 재전송을 대신한다(억제 창이 재전송 간격·전송 시간보다 짧을 때)
    const attempt = ++this.attemptSeq;
    this.latestAttempt.set(key, attempt);
    const ok = await this.transport(discordWebhookUrl, message, origin);
    if (ok || this.latestAttempt.get(key) !== attempt) {
      this.settle(key, attempt);
      return ok ? 'sent' : 'failed';
    }
    this.logger.warn(
      `${line} — Discord 전송 실패, ${ALERT_RETRY_DELAY_MS}ms 뒤 1회 재전송`,
      { detail: message.detail },
    );
    this.scheduleRetry(discordWebhookUrl, message, origin, line, key, attempt);
    return 'failed';
  }

  private settle(key: string, attempt: number): void {
    if (this.latestAttempt.get(key) === attempt) this.latestAttempt.delete(key);
  }

  /** 주문·환불 건별 key가 쌓이지 않게 억제 창이 지난 key를 지운다. */
  private forgetExpired(now: number, windowMs: number): void {
    for (const [key, at] of this.lastSentAt) {
      if (now - at >= windowMs) this.lastSentAt.delete(key);
    }
  }

  /**
   * 일회성 사건(outbox FAILED 1건 등)의 유일한 경보가 잠깐의 웹훅 장애로 사라지지 않게 1회만 뒤늦게 다시 보낸다.
   * 억제 창은 첫 시도가 열었으므로 재전송은 창과 무관하다. 그래도 실패하면 창이 지난 다음 발생 때 다시.
   */
  private scheduleRetry(
    url: string,
    message: AlertMessage,
    origin: Parameters<AlertTransport>[2],
    line: string,
    key: string,
    attempt: number,
  ): void {
    const timer = setTimeout(() => {
      if (this.latestAttempt.get(key) !== attempt) return;
      void this.transport(url, message, origin).then((ok) => {
        this.settle(key, attempt);
        if (!ok) {
          this.logger.warn(`${line} — 재전송도 실패`, {
            detail: message.detail,
          });
        }
      });
    }, ALERT_RETRY_DELAY_MS);
    timer.unref();
  }
}
