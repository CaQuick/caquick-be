import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ClockService } from '@/common/providers/clock.service';
import { HOUR_MS } from '@/common/utils/kst-time';
import { resolveAppRole, runsBackgroundJobs } from '@/config/app.config';
import { OrderCustomUploadRepository } from '@/features/order/repositories/order-custom-upload.repository';
import { AlertService } from '@/global/alerting';
import { S3Service } from '@/global/storage/s3.service';

/** 발급 뒤 이만큼 주문에 쓰이지 않은 업로드를 지운다. */
export const UNUSED_UPLOAD_TTL_MS = 24 * HOUR_MS;
/** 정리 중(PURGING)으로 남은 업로드는 이만큼 지나 다시 지운다. */
export const PURGE_RETRY_AFTER_MS = HOUR_MS;
export const PURGE_BATCH_LIMIT = 500;
/** 한 틱에서 도는 묶음 상한(밀린 양이 많아도 다음 틱으로 넘긴다). */
export const PURGE_MAX_BATCHES = 20;

/**
 * 주문에 쓰이지 않은 커스텀 업로드 정리(매시 20분, worker). PURGING 표시를 먼저 커밋해 주문이 붙이지 못하게 한 뒤
 * S3에서 지우고, 지워진 것만 기록을 지운다. 삭제 실패는 PURGING으로 남겨 다음 정리에서 다시 시도하고 경보한다.
 */
@Injectable()
export class OrderCustomUploadCleanupScheduler {
  private readonly logger = new Logger(OrderCustomUploadCleanupScheduler.name);
  private running = false;

  constructor(
    private readonly uploads: OrderCustomUploadRepository,
    private readonly s3: S3Service,
    private readonly clock: ClockService,
    private readonly alerts: AlertService,
  ) {}

  /** 크론(ScheduleModule)은 worker에만 실리지만 역할도 함께 본다 — api·ws에서 호출돼도 S3를 지우지 않게. */
  @Cron('0 20 * * * *')
  async purgeUnusedUploads(): Promise<void> {
    if (!runsBackgroundJobs(resolveAppRole()) || this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`커스텀 업로드 정리 실패: ${detail}`);
      await this.alerts.notify({
        level: 'error',
        title: '커스텀 업로드 정리 실패',
        key: 'order-custom-upload:purge',
        detail,
      });
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const now = this.clock.now();
    for (let batch = 0; batch < PURGE_MAX_BATCHES; batch++) {
      const claimed = await this.uploads.claimForPurge({
        now,
        pendingCreatedBefore: new Date(now.getTime() - UNUSED_UPLOAD_TTL_MS),
        purgingStartedBefore: new Date(now.getTime() - PURGE_RETRY_AFTER_MS),
        limit: PURGE_BATCH_LIMIT,
      });
      if (claimed.length === 0) return;

      const failures = await this.s3.deleteObjects(
        claimed.map((row) => row.object_key),
      );
      const failedKeys = new Set(failures.map((f) => f.key));
      await this.uploads.deletePurged(
        claimed
          .filter((row) => !failedKeys.has(row.object_key))
          .map((row) => row.id),
      );
      if (failures.length > 0) {
        // 남은 행은 PURGING이라 1시간 뒤 정리에서 다시 시도한다. S3 장애면 더 묶음을 잡지 않는다
        const codes = [...new Set(failures.map((f) => f.code))].join(', ');
        await this.alerts.notify({
          level: 'error',
          title: '커스텀 업로드 S3 삭제 실패',
          key: 'order-custom-upload:purge',
          detail: `${failures.length}/${claimed.length}건 실패(${codes}) — 다음 정리에서 다시 시도`,
        });
        return;
      }
      if (claimed.length < PURGE_BATCH_LIMIT) return;
    }
  }
}
