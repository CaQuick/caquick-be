import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ClockService } from '@/common/providers/clock.service';
import { HOUR_MS } from '@/common/utils/kst-time';
import { resolveAppRole, runsBackgroundJobs } from '@/config/app.config';
import type { ExpoPushConfig } from '@/config/expo-push.config';
import {
  EXPO_ERROR_DEVICE_NOT_REGISTERED,
  EXPO_ERROR_UNKNOWN,
  PUSH_DEVICE_DISABLED_REASON,
} from '@/features/notification/constants/seller-push.constants';
import {
  type ReceiptResult,
  SellerPushDeliveryRepository,
} from '@/features/notification/repositories/seller-push-delivery.repository';
import { SellerPushDeviceRepository } from '@/features/notification/repositories/seller-push-device.repository';
import { AlertService } from '@/global/alerting';
import {
  EXPO_PUSH_TRANSPORT,
  ExpoPushAuthError,
  type ExpoPushTransport,
} from '@/global/expo-push';

/** Expo가 영수증을 준비하는 데 두는 여유. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;
/** 이 뒤에도 영수증이 없으면 RECEIPT_UNKNOWN으로 닫는다(Expo 보관 기한 24h). */
export const RECEIPT_GIVE_UP_MS = 24 * HOUR_MS;
export const RECEIPT_BATCH_LIMIT = 300;

/**
 * Expo 영수증 조회(5분, worker). ticket만으로는 APNs/FCM 거절(DeviceNotRegistered 등)을 모르므로 뒤늦게 확인해 디바이스를 비활성한다.
 * 실패는 던지지 않고 경보만 — 다음 틱이 같은 행을 다시 본다.
 */
@Injectable()
export class SellerPushReceiptScheduler {
  private readonly logger = new Logger(SellerPushReceiptScheduler.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly deliveries: SellerPushDeliveryRepository,
    private readonly devices: SellerPushDeviceRepository,
    private readonly clock: ClockService,
    private readonly alerts: AlertService,
    @Inject(EXPO_PUSH_TRANSPORT) private readonly transport: ExpoPushTransport,
  ) {}

  /** 크론(ScheduleModule)은 worker에만 실리지만 역할도 함께 본다 — api·ws에서 호출돼도 Expo를 부르지 않게. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkReceipts(): Promise<void> {
    if (!runsBackgroundJobs(resolveAppRole())) return;
    const cfg = this.config.getOrThrow<ExpoPushConfig>('expoPush');
    if (!cfg.enabled || this.running) return;
    this.running = true;
    try {
      await this.run(cfg);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Expo 푸시 영수증 조회 실패: ${detail}`);
      await this.alerts.notify(
        error instanceof ExpoPushAuthError
          ? {
              level: 'error',
              title: 'Expo 푸시 인증 실패',
              key: 'expo-push:auth',
              detail: `${detail} — EXPO_PUSH_ACCESS_TOKEN 확인`,
            }
          : {
              level: 'warn',
              title: 'Expo 푸시 영수증 조회 실패',
              key: 'expo-push:receipts',
              detail,
            },
      );
    } finally {
      this.running = false;
    }
  }

  private async run(cfg: ExpoPushConfig): Promise<void> {
    const now = this.clock.now();
    const rows = await this.deliveries.listForReceipt({
      sentBefore: new Date(now.getTime() - RECEIPT_DELAY_MS),
      limit: RECEIPT_BATCH_LIMIT,
    });
    if (rows.length === 0) return;
    const receipts = await this.transport.getReceipts(
      rows.map((row) => row.ticket_id),
      { accessToken: cfg.accessToken, timeoutMs: cfg.requestTimeoutMs },
    );
    const results: ReceiptResult[] = [];
    const notRegistered: bigint[] = [];
    for (const row of rows) {
      const receipt = receipts[row.ticket_id];
      if (!receipt) {
        if (now.getTime() - row.sent_at.getTime() >= RECEIPT_GIVE_UP_MS)
          results.push({ id: row.id, status: 'RECEIPT_UNKNOWN' });
        continue;
      }
      if (receipt.status === 'ok') {
        results.push({ id: row.id, status: 'RECEIPT_OK' });
        continue;
      }
      const errorCode = receipt.details?.error ?? EXPO_ERROR_UNKNOWN;
      results.push({ id: row.id, status: 'RECEIPT_ERROR', errorCode });
      if (errorCode === EXPO_ERROR_DEVICE_NOT_REGISTERED)
        notRegistered.push(row.push_device_id);
    }
    // 비활성(멱등)이 먼저 — 행을 닫은 뒤 죽으면 다음 틱이 그 행을 다시 보지 않아 디바이스가 영영 남는다
    await this.devices.disableByIds(
      notRegistered,
      PUSH_DEVICE_DISABLED_REASON.DEVICE_NOT_REGISTERED,
      now,
    );
    await this.deliveries.markReceipts(results, now);
  }
}
