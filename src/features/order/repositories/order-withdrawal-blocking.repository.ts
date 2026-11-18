import { Injectable } from '@nestjs/common';

import { WithdrawalBlockingOrderQuery } from '@/common/ports/withdrawal-blocking-order.port';
import { IN_PROGRESS_ORDER_STATUSES } from '@/features/order/constants/order-status-traits';
import { RefundStatus } from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

/** 탈퇴 차단 포트 구현. 돌려줄 돈이 남은 구매자가 탈퇴하면 환불 계좌를 받을 수 없어 막는다. */
@Injectable()
export class OrderWithdrawalBlockingRepository extends WithdrawalBlockingOrderQuery {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async countByBuyer(accountId: bigint): Promise<number> {
    const [orders, refunds] = await Promise.all([
      this.prisma.order.count({
        where: {
          account_id: accountId,
          status: { in: [...IN_PROGRESS_ORDER_STATUSES] },
        },
      }),
      this.prisma.refund.count({
        where: {
          status: { not: RefundStatus.COMPLETED },
          order: { account_id: accountId, ...activeWhere },
        },
      }),
    ]);
    return orders + refunds;
  }
}
