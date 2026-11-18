import { Injectable } from '@nestjs/common';

import type { TimestampIdCursor } from '@/common/utils/keyset-cursor';
import {
  OrderStatus,
  PaymentStatus,
  type Prisma,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

/** 구매자·관리자 결제 출력이 공통으로 읽는 열. */
export const orderPaymentSelect = {
  method: true,
  status: true,
  amount: true,
  depositor_name: true,
  deposit_bank_code: true,
  deposit_account_number: true,
  deposit_account_holder: true,
  expires_at: true,
  buyer_claimed_at: true,
  confirmed_at: true,
  confirm_source: true,
} satisfies Prisma.PaymentSelect;

export type OrderPaymentRow = Prisma.PaymentGetPayload<{
  select: typeof orderPaymentSelect;
}>;

/** 확인을 기다리는 결제: 결제 PENDING이고 주문이 아직 입금 대기다. */
const awaitingConfirmationWhere = {
  status: PaymentStatus.PENDING,
  order: { status: OrderStatus.PENDING_PAYMENT, ...activeWhere },
} satisfies Prisma.PaymentWhereInput;

const pendingPaymentInclude = {
  order: {
    select: {
      id: true,
      order_number: true,
      buyer_name: true,
      buyer_phone: true,
      pickup_at: true,
      created_at: true,
      items: {
        where: activeWhere,
        select: { store_name_snapshot: true, product_name_snapshot: true },
        orderBy: { id: 'asc' },
        take: 1,
      },
    },
  },
} satisfies Prisma.PaymentInclude;

export type PendingPaymentRow = Prisma.PaymentGetPayload<{
  include: typeof pendingPaymentInclude;
}>;

export interface PendingPaymentFilter {
  claimedOnly: boolean;
  amount?: number;
  depositorName?: string;
}

export type DepositClaimResult =
  | 'claimed'
  | 'already-claimed'
  | 'not-found'
  | 'not-pending'
  | 'deadline-passed';

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private pendingScopeWhere(
    filter: PendingPaymentFilter,
  ): Prisma.PaymentWhereInput {
    return {
      ...awaitingConfirmationWhere,
      ...(filter.claimedOnly ? { buyer_claimed_at: { not: null } } : {}),
      ...(filter.amount !== undefined ? { amount: filter.amount } : {}),
      ...(filter.depositorName
        ? { depositor_name: { contains: filter.depositorName } }
        : {}),
    };
  }

  /** '입금했어요' 목록은 누른 시각, 전체 목록은 생성 순(결제 id)으로 오래된 것부터. */
  async listPendingPayments(
    filter: PendingPaymentFilter & {
      limit: number;
      claimedCursor?: TimestampIdCursor;
      idCursor?: bigint;
    },
  ): Promise<PendingPaymentRow[]> {
    const after: Prisma.PaymentWhereInput = filter.claimedOnly
      ? filter.claimedCursor
        ? {
            OR: [
              { buyer_claimed_at: { gt: filter.claimedCursor.timestamp } },
              {
                buyer_claimed_at: filter.claimedCursor.timestamp,
                id: { gt: filter.claimedCursor.id },
              },
            ],
          }
        : {}
      : filter.idCursor !== undefined
        ? { id: { gt: filter.idCursor } }
        : {};
    return this.prisma.payment.findMany({
      where: { AND: [this.pendingScopeWhere(filter), after] },
      include: pendingPaymentInclude,
      orderBy: filter.claimedOnly
        ? [{ buyer_claimed_at: 'asc' }, { id: 'asc' }]
        : { id: 'asc' },
      take: filter.limit + 1,
    });
  }

  async countPendingPayments(filter: PendingPaymentFilter): Promise<number> {
    return this.prisma.payment.count({ where: this.pendingScopeWhere(filter) });
  }

  /**
   * 마감 전 첫 누름만 기록한다. 다시 누르면 아무것도 바꾸지 않는다(멱등).
   * 잠금 순서는 주문 → 결제(입금 확인과 같다).
   */
  async markDepositClaimed(args: {
    orderId: bigint;
    accountId: bigint;
    now: Date;
  }): Promise<DepositClaimResult> {
    return this.prisma.$transaction(async (tx) => {
      const [order] = await tx.$queryRaw<{ id: bigint; status: OrderStatus }[]>`
        SELECT id, status FROM \`order\`
        WHERE id = ${args.orderId} AND account_id = ${args.accountId} AND deleted_at IS NULL
        FOR UPDATE`;
      if (!order) return 'not-found';
      await tx.$queryRaw`SELECT id FROM payment WHERE order_id = ${order.id} FOR UPDATE`;
      const payment = await tx.payment.findUnique({
        where: { order_id: order.id },
      });
      if (
        order.status !== OrderStatus.PENDING_PAYMENT ||
        payment?.status !== PaymentStatus.PENDING
      ) {
        return 'not-pending';
      }
      if (payment.buyer_claimed_at) return 'already-claimed';
      if (args.now >= payment.expires_at) return 'deadline-passed';

      await tx.payment.update({
        where: { id: payment.id },
        data: { buyer_claimed_at: args.now },
      });
      return 'claimed';
    });
  }
}
