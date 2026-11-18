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

/**
 * 주간 정산(월 05:00 KST, worker). 지난주(월~일, KST)까지 확정된 주문을 매장별 정산(PENDING)으로 묶는다.
 * 매장마다 따로 커밋하고 이미 만든 주는 건너뛰어, 실패한 매장만 다음 실행(부팅·다음 주)에서 다시 시도된다.
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

  /** 만든 정산 수. 실패는 던지지 않고 경보한다. */
  async settleLastWeek(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.run();
    } catch (error) {
      await this.fail(error instanceof Error ? error.message : String(error));
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<number> {
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
    for (const storeId of await this.settlements.findUnsettledStoreIds(
      weekStart,
    )) {
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
    }
    if (failed.length > 0) await this.fail(failed.join('\n'));
    return created;
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
