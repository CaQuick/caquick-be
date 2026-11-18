import { Injectable } from '@nestjs/common';

import { orderConfirmReminderDueEvent } from '@/features/order/events/order-confirm-reminder-due.event';
import {
  CONFIRM_REMINDER_LEAD_MS,
  type ConfirmReminderState,
} from '@/features/order/policies/order-lifecycle.policy';
import { AUTO_PICKUP_DELAY_MS } from '@/features/order/policies/order-status-transition.policy';
import { OutboxPublisher } from '@/features/outbox';
import { OrderStatus, PaymentStatus, Prisma } from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

/** 키셋 한 페이지(id 오름차순). afterId 다음부터 limit건. */
export interface CandidatePage {
  now: Date;
  afterId?: bigint;
  limit: number;
}

function afterIdWhere(page: CandidatePage) {
  return page.afterId !== undefined ? { id: { gt: page.afterId } } : {};
}

function keysetPage(page: CandidatePage) {
  return {
    select: { id: true },
    orderBy: { id: 'asc' as const },
    take: page.limit,
  };
}

/**
 * 자동 전이 크론의 대상 고르기와 미리 알림 기록. 전이 자체는 OrderTransitionRepository가 건마다 잠근 뒤 다시 판정한다 —
 * 여기 조건은 후보를 좁히는 용도라 잠금 없이 읽는다.
 */
@Injectable()
export class OrderLifecycleRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisher,
  ) {}

  /** 입금 기한이 지났고 '입금했어요'를 누르지 않은 입금 대기. */
  async findPaymentExpiredIds(page: CandidatePage): Promise<bigint[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        payment: {
          status: PaymentStatus.PENDING,
          buyer_claimed_at: null,
          expires_at: { lte: page.now },
        },
        ...afterIdWhere(page),
      },
      ...keysetPage(page),
    });
    return rows.map((row) => row.id);
  }

  /** 확정 마감이 지난 접수. 결제 도입 전 접수는 마감이 없어 빠진다. */
  async findConfirmTimedOutIds(page: CandidatePage): Promise<bigint[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.SUBMITTED,
        confirm_deadline_at: { lte: page.now },
        ...afterIdWhere(page),
      },
      ...keysetPage(page),
    });
    return rows.map((row) => row.id);
  }

  /** 픽업 + 24시간이 지난 확정·제작 완료. 숨긴 매장의 주문은 관리자가 건별로 처리하므로 뺀다. */
  async findAutoPickupIds(
    page: CandidatePage & { excludeStoreIds: bigint[] },
  ): Promise<bigint[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.CONFIRMED, OrderStatus.MADE] },
        pickup_at: {
          lte: new Date(page.now.getTime() - AUTO_PICKUP_DELAY_MS),
        },
        ...(page.excludeStoreIds.length > 0
          ? {
              items: {
                none: {
                  store_id: { in: page.excludeStoreIds },
                  ...activeWhere,
                },
              },
            }
          : {}),
        ...afterIdWhere(page),
      },
      ...keysetPage(page),
    });
    return rows.map((row) => row.id);
  }

  /** 마감 2시간 전 구간의 미발송 접수. 접수 시점 조건은 열 비교라 raw다. */
  async findConfirmReminderDueIds(page: CandidatePage): Promise<bigint[]> {
    const remindBefore = new Date(
      page.now.getTime() + CONFIRM_REMINDER_LEAD_MS,
    );
    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
      SELECT o.id FROM \`order\` o
      WHERE o.status = 'SUBMITTED'
        AND o.deleted_at IS NULL
        AND o.confirm_reminder_sent_at IS NULL
        AND o.confirm_deadline_at > ${page.now}
        AND o.confirm_deadline_at <= ${remindBefore}
        AND o.confirm_deadline_at - INTERVAL ${CONFIRM_REMINDER_LEAD_MS / 1000} SECOND > o.submitted_at
        ${page.afterId !== undefined ? Prisma.sql`AND o.id > ${page.afterId}` : Prisma.empty}
      ORDER BY o.id
      LIMIT ${page.limit}`;
    return rows.map((row) => row.id);
  }

  /**
   * 미리 알림 1회: 잠금 뒤 isDue로 다시 판정하고 발송 표시와 판매자 푸시 이벤트를 같은 tx에 남긴다.
   * 대상이 아니게 됐으면(확정·취소·이미 발송) false.
   */
  async markConfirmReminderSent(args: {
    orderId: bigint;
    now: Date;
    isDue: (state: ConfirmReminderState) => boolean;
  }): Promise<boolean> {
    const { orderId, now } = args;
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        {
          id: bigint;
          order_number: string;
          status: OrderStatus;
          submitted_at: Date | null;
          confirm_deadline_at: Date | null;
          confirm_reminder_sent_at: Date | null;
        }[]
      >`
        SELECT id, order_number, status, submitted_at, confirm_deadline_at, confirm_reminder_sent_at
        FROM \`order\` WHERE id = ${orderId} AND deleted_at IS NULL
        FOR UPDATE`;
      if (
        !locked?.confirm_deadline_at ||
        !args.isDue({
          status: locked.status,
          submittedAt: locked.submitted_at,
          confirmDeadlineAt: locked.confirm_deadline_at,
          confirmReminderSentAt: locked.confirm_reminder_sent_at,
        })
      ) {
        return false;
      }
      const firstItem = await tx.orderItem.findFirst({
        where: { order_id: locked.id, ...activeWhere },
        orderBy: { id: 'asc' },
        select: { store_id: true, product_name_snapshot: true },
      });
      await tx.order.update({
        where: { id: locked.id },
        data: { confirm_reminder_sent_at: now },
      });
      // 품목이 없으면 매장을 몰라 보낼 곳이 없다 — 표시만 남겨 다시 고르지 않게 한다
      if (firstItem) {
        await this.outbox.publish(
          tx,
          orderConfirmReminderDueEvent({
            orderId: locked.id,
            orderNumber: locked.order_number,
            storeId: firstItem.store_id,
            productName: firstItem.product_name_snapshot,
            confirmDeadlineAt: locked.confirm_deadline_at,
            occurredAt: now,
          }),
        );
      }
      return true;
    });
  }
}
