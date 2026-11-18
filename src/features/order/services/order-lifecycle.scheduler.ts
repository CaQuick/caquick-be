import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ClockService } from '@/common/providers/clock.service';
import { resolveAppRole, runsBackgroundJobs } from '@/config/app.config';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import {
  isConfirmReminderDue,
  isConfirmTimedOut,
  isPaymentExpired,
} from '@/features/order/policies/order-lifecycle.policy';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import {
  OrderLifecycleRepository,
  type CandidatePage,
} from '@/features/order/repositories/order-lifecycle.repository';
import {
  OrderTransitionRepository,
  type CancelOrderArgs,
} from '@/features/order/repositories/order-transition.repository';
import type { AdminOrderRow } from '@/features/order/repositories/order.repository';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { StoreAdminRepository } from '@/features/store';
import {
  OrderActor,
  OrderCancelReason,
  OrderStatus,
} from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';

/** 후보는 id 순 100건씩, 한 틱에 최대 1000건까지 본다(밀린 양은 다음 틱으로). */
export const LIFECYCLE_BATCH_SIZE = 100;
export const LIFECYCLE_MAX_PER_TICK = 1000;

type LifecycleJob =
  'payment-expired' | 'confirm-reminder' | 'confirm-timeout' | 'auto-pickup';

/**
 * 주문 자동 전이(worker 크론). 후보 id만 고른 뒤 건마다 repository가 연 tx에서 잠그고 이 정책으로 다시 판정한다 —
 * 그사이 다른 전이·'입금했어요'가 끼면 건너뛴다. 건별 실패는 로그와 경보를 남기고 다음 건으로 넘어간다.
 */
@Injectable()
export class OrderLifecycleScheduler {
  private readonly logger = new Logger(OrderLifecycleScheduler.name);
  private readonly running = new Set<LifecycleJob>();

  constructor(
    private readonly lifecycle: OrderLifecycleRepository,
    private readonly transitions: OrderTransitionRepository,
    private readonly stores: StoreAdminRepository,
    private readonly cancelPolicy: OrderCancelPolicy,
    private readonly statusPolicy: OrderStatusTransitionPolicy,
    private readonly events: OrderEventsService,
    private readonly clock: ClockService,
    private readonly alerts: AlertService,
  ) {}

  /** ① 입금 기한(주문 + 1시간)이 지난 미클레임 입금 대기를 취소한다(환불 없음). */
  @Cron('0 * * * * *')
  cancelExpiredPayments(): Promise<void> {
    return this.tick('payment-expired', async (now) => {
      await this.forEachCandidate(
        'payment-expired',
        (page) => this.lifecycle.findPaymentExpiredIds({ ...page, now }),
        (orderId) =>
          this.systemCancel(
            orderId,
            now,
            OrderCancelReason.PAYMENT_NOT_RECEIVED,
            (s) => isPaymentExpired(s, now),
          ),
      );
    });
  }

  /** ② 확정 마감 2시간 전 판매자 미리 알림(주문당 1회). */
  @Cron('30 * * * * *')
  remindConfirmDeadlines(): Promise<void> {
    return this.tick('confirm-reminder', async (now) => {
      await this.forEachCandidate(
        'confirm-reminder',
        (page) => this.lifecycle.findConfirmReminderDueIds({ ...page, now }),
        async (orderId) => {
          await this.lifecycle.markConfirmReminderSent({
            orderId,
            now,
            isDue: (state) => isConfirmReminderDue(state, now),
          });
        },
      );
    });
  }

  /** ③ 확정 마감이 지난 접수를 취소한다(전액 환불). 숨긴 매장 주문도 구매자에게 돈을 돌려주는 쪽이라 그대로 적용한다. */
  @Cron('15 * * * * *')
  cancelConfirmTimeouts(): Promise<void> {
    return this.tick('confirm-timeout', async (now) => {
      await this.forEachCandidate(
        'confirm-timeout',
        (page) => this.lifecycle.findConfirmTimedOutIds({ ...page, now }),
        (orderId) =>
          this.systemCancel(
            orderId,
            now,
            OrderCancelReason.CONFIRM_TIMEOUT,
            (s) => isConfirmTimedOut(s, now),
          ),
      );
    });
  }

  /** ④ 픽업 + 24시간이 지난 확정·제작 완료를 픽업 완료로 바꾸고 정산을 확정한다. 숨긴 매장 주문은 관리자가 건별로 처리한다. */
  @Cron('0 */5 * * * *')
  completeOverduePickups(): Promise<void> {
    return this.tick('auto-pickup', async (now) => {
      const excludeStoreIds = await this.stores.findInactiveStoreIds();
      await this.forEachCandidate(
        'auto-pickup',
        (page) =>
          this.lifecycle.findAutoPickupIds({ ...page, now, excludeStoreIds }),
        async (orderId) => {
          const updated = await this.transitions.completePickupBySystem({
            orderId,
            now,
            eligible: (s) =>
              this.statusPolicy.canTransition({
                actor: OrderActor.SYSTEM,
                from: s.status,
                to: OrderStatus.PICKED_UP,
                now,
                pickupAt: s.pickupAt,
              }),
          });
          await this.afterTransition(updated);
        },
      );
    });
  }

  private async systemCancel(
    orderId: bigint,
    now: Date,
    reason: OrderCancelReason,
    eligible: NonNullable<CancelOrderArgs['eligible']>,
  ): Promise<void> {
    const updated = await this.transitions.cancel({
      orderId,
      actor: OrderActor.SYSTEM,
      actorAccountId: null,
      scope: { kind: 'any' },
      note: null,
      now,
      eligible,
      decide: (state) =>
        this.cancelPolicy.decide({ actor: OrderActor.SYSTEM, reason }, state),
    });
    await this.afterTransition(updated);
  }

  /** 커밋 뒤 판매자 구독(입금 전 주문은 발행하지 않는다). 건너뛴 건은 null이다. */
  private async afterTransition(updated: AdminOrderRow | null): Promise<void> {
    if (updated) await this.events.publishSellerStatusChanged(updated);
  }

  /** 크론(ScheduleModule)은 worker에만 실리지만 역할도 함께 본다. 같은 작업의 틱이 겹치면 뒤 틱은 건너뛴다. */
  private async tick(
    job: LifecycleJob,
    run: (now: Date) => Promise<void>,
  ): Promise<void> {
    if (!runsBackgroundJobs(resolveAppRole()) || this.running.has(job)) return;
    this.running.add(job);
    try {
      await run(this.clock.now());
    } catch (error) {
      await this.report(job, error);
    } finally {
      this.running.delete(job);
    }
  }

  private async forEachCandidate(
    job: LifecycleJob,
    findIds: (page: Omit<CandidatePage, 'now'>) => Promise<bigint[]>,
    handle: (orderId: bigint) => Promise<void>,
  ): Promise<void> {
    let afterId: bigint | undefined;
    for (let seen = 0; seen < LIFECYCLE_MAX_PER_TICK;) {
      const ids = await findIds({ afterId, limit: LIFECYCLE_BATCH_SIZE });
      for (const orderId of ids) {
        try {
          await handle(orderId);
        } catch (error) {
          await this.report(job, error, orderId);
        }
      }
      seen += ids.length;
      if (ids.length < LIFECYCLE_BATCH_SIZE) return;
      afterId = ids[ids.length - 1];
    }
  }

  private async report(
    job: LifecycleJob,
    error: unknown,
    orderId?: bigint,
  ): Promise<void> {
    const detail = `${orderId === undefined ? '' : `주문 ${orderId}: `}${
      error instanceof Error ? error.message : String(error)
    }`;
    this.logger.error(`주문 자동 전이(${job}) 실패 — ${detail}`);
    await this.alerts.notify({
      level: 'warn',
      title: '주문 자동 전이 실패',
      key: `order-cron:${job}`,
      detail,
    });
  }
}
