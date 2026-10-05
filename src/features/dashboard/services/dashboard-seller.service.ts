import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import {
  BOOKED_QUANTITY_QUERY,
  type IBookedQuantityQuery,
} from '@/common/ports/booked-quantity.port';
import { ClockService } from '@/common/providers/clock.service';
import {
  formatKstDate,
  kstDayBoundaries,
  parseKstDate,
} from '@/common/utils/kst-time';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { ConversationRepository } from '@/features/conversation';
import type { SellerDashboardInput } from '@/features/dashboard/dto/inputs/seller-dashboard.input';
import type { SellerDashboardOutput } from '@/features/dashboard/types/dashboard-seller-output.type';
import { OrderRepository } from '@/features/order';
import { ProductRepository } from '@/features/product';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';

/**
 * 요청 시 계산하며 스냅샷 테이블은 두지 않는다(관리자 대시보드와 동일). 읽기 7개를 트랜잭션으로 묶지 않는다 —
 * 카드 간 ms 단위 불일치는 허용. capacity는 catalog 정본을, 예약 수량은 픽업 판정과 같은 포트를 읽는다.
 */
@Injectable()
export class SellerDashboardService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly orders: OrderRepository,
    @Inject(BOOKED_QUANTITY_QUERY)
    private readonly booked: IBookedQuantityQuery,
    private readonly products: ProductRepository,
    private readonly conversations: ConversationRepository,
    private readonly clock: ClockService,
  ) {
    super(repo, auditLogs);
  }

  async sellerDashboard(
    accountId: bigint,
    input?: SellerDashboardInput | null,
  ): Promise<SellerDashboardOutput> {
    const { storeId } = await this.requireSellerContext(accountId);
    const asOf = this.clock.now();
    // 빈 문자열은 오늘로 폴백하지 않고 INVALID_DATE
    const day = parseKstDate(input?.date ?? formatKstDate(asOf));
    if (!day) throw new DomainException('INVALID_DATE');
    const { dateOnlyUtc, dayStartUtc, dayEndUtc } = kstDayBoundaries(day);

    const [
      newOrderCount,
      pickupDay,
      createdDay,
      capacityRow,
      bookedByStore,
      activeProductCount,
      unansweredConversationCount,
    ] = await Promise.all([
      this.orders.countOrdersByStore({ storeId, status: 'SUBMITTED' }),
      this.orders.aggregateStoreOrdersInRange({
        storeId,
        from: dayStartUtc,
        to: dayEndUtc,
        basis: 'pickup',
      }),
      this.orders.aggregateStoreOrdersInRange({
        storeId,
        from: dayStartUtc,
        to: dayEndUtc,
        basis: 'created',
      }),
      this.repo.findStoreDailyCapacityByDate(storeId, dateOnlyUtc),
      this.booked.sumByStore([storeId], dayStartUtc, dayEndUtc),
      this.products.countProductsByStore({ storeId, isActive: true }),
      this.conversations.countUnansweredConversationsByStore(storeId),
    ]);

    const bookedQuantity = bookedByStore.get(storeId) ?? 0;
    const capacity = capacityRow?.capacity ?? null;
    return {
      date: formatKstDate(day),
      asOf,
      newOrderCount,
      pickupDay,
      createdDay,
      capacity,
      // 복제 지연 구간에는 capacity를 넘겨 접수될 수 있어 음수를 0으로 자른다
      remainingCapacity:
        capacity === null ? null : Math.max(capacity - bookedQuantity, 0),
      bookedQuantity,
      activeProductCount,
      unansweredConversationCount,
    };
  }
}
