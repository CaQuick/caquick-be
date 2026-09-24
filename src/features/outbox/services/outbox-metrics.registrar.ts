import { Injectable, type OnModuleInit } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { resolveAppRole, runsBackgroundJobs } from '@/config/app.config';
import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import { MetricsService } from '@/global/metrics';

/**
 * outbox 게이지(P2 05): 상태별 건수와 릴레이 lag. 값은 스크레이프 때 계산한다(카운트 쿼리 2개).
 * worker에서만 등록한다 — 전역 값이라 api 복제본마다 노출하면 sum()이 부풀고 스크레이프마다 DB 쿼리가 N배다.
 */
@Injectable()
export class OutboxMetricsRegistrar implements OnModuleInit {
  constructor(
    private readonly metrics: MetricsService,
    private readonly repo: OutboxRepository,
    private readonly clock: ClockService,
  ) {}

  onModuleInit(): void {
    return;
  }

  /** 테스트가 역할과 무관하게 직접 부른다 */
  register(): void {
    this.metrics.registerGauge({
      name: 'caquick_outbox_events',
      help: 'outbox 행 수(status별). FAILED > 0이면 사람이 requeue해야 한다.',
      labelNames: ['status'] as const,
      collect: async (gauge) => {
        const counts = await this.repo.countByStatus();
        for (const [status, count] of Object.entries(counts)) {
          gauge.set({ status }, count);
        }
      },
    });
    this.metrics.registerGauge({
      name: 'caquick_outbox_oldest_pending_age_seconds',
      help: '기한이 된(next_attempt_at 경과) PENDING 중 가장 오래된 것의 나이(초). 릴레이가 밀리면 커진다. 없으면 0. 백오프 대기 중인 행은 세지 않는다.',
      collect: async (gauge) => {
        const now = this.clock.now();
        const oldest = await this.repo.oldestDuePendingOccurredAt(now);
        gauge.set(
          oldest ? Math.max(0, (now.getTime() - oldest.getTime()) / 1000) : 0,
        );
      },
    });
  }
}
