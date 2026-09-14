import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { toDate } from '@/common/utils/date-parser';
import {
  nextCursorOf,
  normalizeCursorInput,
} from '@/common/utils/id-cursor-page';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import { ORDER_NOT_FOUND } from '@/features/admin/constants/admin-error-messages';
import {
  ADMIN_CANCEL_NOTE_PREFIX,
  MAX_ADMIN_CANCEL_NOTE_LENGTH,
} from '@/features/admin/constants/admin.constants';
import type { AdminCancelOrderInput } from '@/features/admin/dto/inputs/admin-cancel-order.input';
import type { AdminOrderListInput } from '@/features/admin/dto/inputs/admin-order-list.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import {
  toAdminOrderDetailOutput,
  toAdminOrderSummaryOutput,
} from '@/features/admin/services/admin-order-mappers.helper';
import type {
  AdminCursorConnection,
  AdminOrderDetailOutput,
  AdminOrderSummaryOutput,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { OrderDomainService, OrderRepository } from '@/features/order';
import { OrderStatus } from '@/generated/prisma/client';

/**
 * 주문 조회와 강제 취소. 전이 규칙은 판매자와 같은 OrderDomainService가 단일 소스이고,
 * 저장·이력·알림·감사는 order feature의 repository가 한 트랜잭션에서 처리한다.
 */
@Injectable()
export class AdminOrderService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly orderRepository: OrderRepository,
    private readonly orderDomainService: OrderDomainService,
  ) {
    super(repo, auditLogs);
  }

  async adminOrders(
    accountId: bigint,
    input?: AdminOrderListInput,
  ): Promise<AdminCursorConnection<AdminOrderSummaryOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: parseOptionalId(input?.cursor),
    });
    const filter = {
      keyword: input?.keyword?.trim() || undefined,
      status: input?.status
        ? this.orderDomainService.parseStatus(input.status)
        : undefined,
      storeId: parseOptionalId(input?.storeId) ?? undefined,
      accountId: parseOptionalId(input?.accountId) ?? undefined,
      fromCreatedAt: toDate(input?.fromCreatedAt),
      toCreatedAt: toDate(input?.toCreatedAt),
    };

    const [rows, totalCount] = await Promise.all([
      this.orderRepository.listOrdersForAdmin({ ...filter, ...normalized }),
      this.orderRepository.countOrdersForAdmin(filter),
    ]);
    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminOrderSummaryOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminOrder(
    accountId: bigint,
    orderId: bigint,
  ): Promise<AdminOrderDetailOutput> {
    await this.requireAdminContext(accountId);
    const row = await this.orderRepository.findOrderDetailForAdmin(orderId);
    if (!row) throw new NotFoundException(ORDER_NOT_FOUND);
    return toAdminOrderDetailOutput(row);
  }

  async adminCancelOrder(
    accountId: bigint,
    input: AdminCancelOrderInput,
  ): Promise<AdminOrderSummaryOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const note = cleanRequiredText(input.note, MAX_ADMIN_CANCEL_NOTE_LENGTH);
    // 사전 검사는 빠른 거절용 — 최종 판정은 repository가 잠금 뒤 트랜잭션 안에서 다시 한다
    const current = await this.orderRepository.findOrderDetailForAdmin(
      parseId(input.orderId),
    );
    if (!current) throw new NotFoundException(ORDER_NOT_FOUND);
    this.orderDomainService.assertSellerTransition(
      current.status,
      OrderStatus.CANCELED,
    );

    const updated = await this.orderRepository.cancelOrderByAdmin({
      orderId: current.id,
      actorAccountId: ctx.accountId,
      note: `${ADMIN_CANCEL_NOTE_PREFIX}${note}`,
      now: new Date(),
      // 잠금 뒤 현재 상태가 취소 가능한지 repository가 이 함수로 다시 판정한다
      canCancelFrom: (status) => {
        try {
          this.orderDomainService.assertSellerTransition(
            status,
            OrderStatus.CANCELED,
          );
          return true;
        } catch {
          return false;
        }
      },
    });
    if (updated === 'not-found') throw new NotFoundException(ORDER_NOT_FOUND);
    if (updated === 'not-cancellable') {
      // 사전 검사 뒤 상태가 바뀐 경쟁 — 같은 규칙으로 다시 던진다
      const latest = await this.orderRepository.findOrderDetailForAdmin(
        current.id,
      );
      this.orderDomainService.assertSellerTransition(
        latest?.status ?? OrderStatus.CANCELED,
        OrderStatus.CANCELED,
      );
      throw new BadRequestException(ORDER_NOT_FOUND);
    }
    return toAdminOrderSummaryOutput(updated);
  }
}
