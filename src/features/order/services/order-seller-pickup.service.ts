import { Inject, Injectable } from '@nestjs/common';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import { parseId } from '@/common/utils/id-parser';
import { formatKstDate, kstDayBoundaries } from '@/common/utils/kst-time';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import type { SellerRescheduleOrderPickupInput } from '@/features/order/dto/inputs/seller-reschedule-order-pickup.input';
import { OrderStatusTransitionPolicy } from '@/features/order/policies/order-status-transition.policy';
import { OrderPickupChangeRepository } from '@/features/order/repositories/order-pickup-change.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { toSellerOrderUpdateEvent } from '@/features/order/services/order-events-mappers.helper';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { toSellerOrderSummaryOutput } from '@/features/order/services/order-seller-mappers.helper';
import type { SellerOrderSummaryOutput } from '@/features/order/types/order-seller-output.type';
import {
  SellerBaseService,
  StorePickupScheduleService,
  StoreSellerRepository,
  type BookedAdjustment,
  type PickupCalendar,
  type PickupTimeSlots,
} from '@/features/store';
import type { OrderStatus } from '@/generated/prisma/client';

/**
 * 판매자 픽업 일시 변경(접수·확정·제작 완료). 검사는 영업일·특별휴무·슬롯 시각·과거 금지·예약 가능 기간·제작 수량이고
 * 리드타임·상품 제작 시간은 보지 않는다. 숨긴 매장의 진행 주문도 옮길 수 있다.
 */
@Injectable()
export class SellerOrderPickupService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly orderRepository: OrderRepository,
    private readonly pickupChanges: OrderPickupChangeRepository,
    private readonly statusPolicy: OrderStatusTransitionPolicy,
    private readonly pickupSchedule: StorePickupScheduleService,
    private readonly events: OrderEventsService,
    private readonly clock: ClockService,
  ) {
    super(repo, auditLogs);
  }

  async sellerOrderPickupCalendar(
    accountId: bigint,
    orderId: bigint,
    yearMonth: string,
  ): Promise<PickupCalendar> {
    const { storeId, adjustment } = await this.requireReschedulable(
      accountId,
      orderId,
    );
    return this.pickupSchedule.rescheduleCalendar(
      storeId,
      yearMonth,
      adjustment,
    );
  }

  async sellerOrderPickupTimeSlots(
    accountId: bigint,
    orderId: bigint,
    date: string,
  ): Promise<PickupTimeSlots> {
    const { storeId, adjustment } = await this.requireReschedulable(
      accountId,
      orderId,
    );
    return this.pickupSchedule.rescheduleTimeSlots(storeId, date, adjustment);
  }

  async sellerRescheduleOrderPickup(
    accountId: bigint,
    input: SellerRescheduleOrderPickupInput,
  ): Promise<SellerOrderSummaryOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const orderId = parseId(input.orderId);
    const pickupAt = input.pickupAt;
    const current = await this.orderRepository.findOrderDetailByStore({
      orderId,
      storeId: ctx.storeId,
    });
    if (!current) throw new DomainException('ORDER_NOT_FOUND');
    const assertReschedulable = (state: {
      status: OrderStatus;
      pickupAt: Date;
    }) =>
      this.statusPolicy.assertPickupChange({
        status: state.status,
        fromPickupAt: state.pickupAt,
        toPickupAt: pickupAt,
      });
    assertReschedulable({
      status: current.status,
      pickupAt: current.pickup_at,
    });

    const available = await this.pickupSchedule.isPickupSlotAvailable({
      storeId: ctx.storeId,
      pickupAt,
      preparationTimeMinutes: 0,
      leadTime: 'SKIP',
      storeActiveOnly: false,
    });
    if (!available) throw new DomainException('PICKUP_NOT_AVAILABLE');

    const { dateOnlyUtc, dayStartUtc, dayEndUtc } = kstDayBoundaries(pickupAt);
    const result = await this.pickupChanges.reschedule({
      orderId,
      storeId: ctx.storeId,
      actorAccountId: ctx.accountId,
      pickupAt,
      note: cleanNullableText(input.note, MAX_REASON_LENGTH),
      now: this.clock.now(),
      capacityGuard: {
        storeId: ctx.storeId,
        dateOnlyUtc,
        dayStartUtc,
        dayEndUtc,
      },
      // 잠금 뒤 상태·픽업 시각으로 같은 규칙을 다시 적용한다(위 사전 검사는 빠른 거절용)
      assertReschedulable,
    });
    if (result === null) throw new DomainException('ORDER_NOT_FOUND');
    if (result === 'capacity-exceeded') {
      throw new DomainException('PICKUP_NOT_AVAILABLE');
    }

    await this.events.publishSellerOrderUpdate(
      ctx.storeId,
      toSellerOrderUpdateEvent('PICKUP_RESCHEDULED', result),
    );
    return toSellerOrderSummaryOutput(result);
  }

  /** 옮길 수 있는 주문인지 보고, 달력 수량에서 뺄 이 주문의 현재 점유(지금 픽업일·수량)를 만든다. */
  private async requireReschedulable(
    accountId: bigint,
    orderId: bigint,
  ): Promise<{ storeId: bigint; adjustment: BookedAdjustment }> {
    const ctx = await this.requireSellerContext(accountId);
    const order = await this.orderRepository.findOrderDetailByStore({
      orderId,
      storeId: ctx.storeId,
    });
    if (!order) throw new DomainException('ORDER_NOT_FOUND');
    this.statusPolicy.assertPickupReschedulable(order.status);
    return {
      storeId: ctx.storeId,
      adjustment: {
        date: formatKstDate(order.pickup_at),
        quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
      },
    };
  }
}
