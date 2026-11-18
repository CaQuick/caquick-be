import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ClockService } from '@/common/providers/clock.service';
import {
  DAY_MS,
  kstDayBoundaries,
  kstWeekStart,
} from '@/common/utils/kst-time';
import { resolveAppRole, runsBackgroundJobs } from '@/config/app.config';
import { SettlementRepository } from '@/features/order/repositories/settlement.repository';
import { AlertService } from '@/global/alerting';

/** 후보 매장은 id 순 100곳씩, 한 실행에 최대 1000곳까지 본다(남은 매장은 다음 실행으로). */
export const SETTLEMENT_BATCH_SIZE = 100;
export const SETTLEMENT_MAX_PER_RUN = 1000;

interface RunLimits {
  batchSize: number;
  maxPerRun: number;
}

/**
 * 주간 정산(월 05:00 KST, worker). 지난주(월~일, KST)까지 확정된 주문을 매장별 정산(PENDING)으로 묶는다.
 * 매장마다 따로 커밋하고 이미 만든 주는 건너뛰어, 실패했거나 상한에 걸려 남은 매장은 다음 실행(부팅·다음 주)에서 다시 시도된다.
 */
@Injectable()
export class SettlementScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SettlementScheduler.name);
  private running = false;

  constructor(
    private readonly settlements: SettlementRepository,
    private readonly clock: ClockService,
    private readonly alerts: AlertService,
  ) {}

  /** 크론을 놓친 주(배포·중단)도 부팅 때 만든다. 이 훅은 모든 역할에서 돌아 역할을 본다. */
  async onApplicationBootstrap(): Promise<void> {
    if (!runsBackgroundJobs(resolveAppRole())) return;
    await this.settleLastWeek();
  }

  @Cron('0 0 5 * * 1', { timeZone: 'Asia/Seoul' })
  async weeklySettlement(): Promise<void> {
    if (!runsBackgroundJobs(resolveAppRole())) return;
    await this.settleLastWeek();
  }

  /** 만든 정산 수. 실패는 던지지 않고 경보한다. limits는 테스트만 바꾼다. */
  async settleLastWeek(
    limits: RunLimits = {
      batchSize: SETTLEMENT_BATCH_SIZE,
      maxPerRun: SETTLEMENT_MAX_PER_RUN,
    },
  ): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.run(limits);
    } catch (error) {
      await this.fail(error instanceof Error ? error.message : String(error));
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async run(limits: RunLimits): Promise<number> {
    const now = this.clock.now();
    const weekStart = kstWeekStart(now);
    const periodStart = kstDayBoundaries(
      new Date(weekStart.getTime() - 7 * DAY_MS),
    ).dateOnlyUtc;
    const periodEnd = kstDayBoundaries(
      new Date(weekStart.getTime() - DAY_MS),
    ).dateOnlyUtc;

    let created = 0;
    const failed: string[] = [];
    await this.forEachCandidateStore(weekStart, limits, async (storeId) => {
      try {
        const settlement = await this.settlements.createWeeklySettlement({
          storeId,
          settledBefore: weekStart,
          periodStart,
          periodEnd,
          now,
        });
        if (settlement) created++;
      } catch (error) {
        failed.push(
          `매장 ${storeId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    if (failed.length > 0) await this.fail(failed.join('\n'));
    return created;
  }

  /** 후보 매장을 id 키셋으로 넘긴다. 실패한 매장도 키셋이 지나가 같은 실행에서 다시 잡히지 않는다. */
  private async forEachCandidateStore(
    before: Date,
    limits: RunLimits,
    handle: (storeId: bigint) => Promise<void>,
  ): Promise<void> {
    let afterStoreId: bigint | undefined;
    for (let seen = 0; seen < limits.maxPerRun;) {
      const limit = Math.min(limits.batchSize, limits.maxPerRun - seen);
      const storeIds = await this.settlements.findUnsettledStoreIds({
        before,
        afterStoreId,
        limit,
      });
      for (const storeId of storeIds) await handle(storeId);
      if (storeIds.length < limit) return;
      seen += limit;
      afterStoreId = storeIds[storeIds.length - 1];
    }
    const [next] = await this.settlements.findUnsettledStoreIds({
      before,
      afterStoreId,
      limit: 1,
    });
    if (next !== undefined) {
      this.logger.warn(
        `주간 정산 상한(${limits.maxPerRun}곳)에 걸려 매장 ${next}부터는 다음 실행에서 정산한다`,
      );
    }
  }

  private async fail(detail: string): Promise<void> {
    this.logger.error(`주간 정산 실패: ${detail}`);
    await this.alerts.notify({
      level: 'warn',
      title: '주간 정산 생성 실패',
      key: 'order-cron:weekly-settlement',
      detail,
    });
  }
}
