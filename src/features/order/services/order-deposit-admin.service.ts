import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import {
  buildTimestampIdCursor,
  parseIdCursor,
  parseTimestampIdCursor,
} from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceCursorPage,
  toCursorConnection,
} from '@/common/utils/pagination';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import type { AdminConfirmPaymentInput } from '@/features/order/dto/inputs/admin-confirm-payment.input';
import type { AdminPendingPaymentListInput } from '@/features/order/dto/inputs/admin-pending-payment-list.input';
import { assertPaymentConfirmable } from '@/features/order/policies/payment-confirm.policy';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import { PaymentRepository } from '@/features/order/repositories/payment.repository';
import { RefundRepository } from '@/features/order/repositories/refund.repository';
import { toAdminOrderSummaryOutput } from '@/features/order/services/order-admin-mappers.helper';
import { toSellerOrderUpdateEvent } from '@/features/order/services/order-events-mappers.helper';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import { toAdminPendingPaymentOutput } from '@/features/order/services/order-payment-mappers.helper';
import type { AdminOrderSummaryOutput } from '@/features/order/types/order-admin-output.type';
import type {
  AdminPendingPaymentOutput,
  AdminTaskCountsOutput,
} from '@/features/order/types/order-payment-output.type';
import { PaymentConfirmSource, RefundStatus } from '@/generated/prisma/client';

const MAX_CONFIRM_NOTE_LENGTH = 500;

/** 관리자 입금 처리 대기(입금 확인). 은행 앱에서 본 입금을 주문과 대조해 접수로 넘긴다. */
@Injectable()
export class AdminDepositService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly payments: PaymentRepository,
    private readonly transitions: OrderTransitionRepository,
    private readonly clock: ClockService,
    private readonly events: OrderEventsService,
    private readonly refunds: RefundRepository,
  ) {
    super(accounts, auditLogs);
  }

  async adminPendingPayments(
    accountId: bigint,
    input?: AdminPendingPaymentListInput,
  ): Promise<CursorConnection<AdminPendingPaymentOutput>> {
    await this.requireAdminContext(accountId);
    // 관리자 FE는 '전체'를 null로 보낸다 — 생략과 같다
    const claimedOnly = input?.claimedOnly ?? false;
    const filter = {
      claimedOnly,
      amount: input?.amount ?? undefined,
      depositorName: input?.depositorName?.trim() || undefined,
    };
    const { limit } = normalizeCursorInput({ limit: input?.limit });
    const cursor = input?.cursor;
    const [rows, totalCount] = await Promise.all([
      this.payments.listPendingPayments({
        ...filter,
        limit,
        ...(cursor === undefined || cursor === null
          ? {}
          : claimedOnly
            ? { claimedCursor: parseTimestampIdCursor(cursor) }
            : { idCursor: parseIdCursor(cursor) }),
      }),
      this.payments.countPendingPayments(filter),
    ]);
    const page = sliceCursorPage(rows, limit, (last) =>
      claimedOnly
        ? buildTimestampIdCursor(last.buyer_claimed_at!, last.id)
        : last.id.toString(),
    );
    return toCursorConnection(page, totalCount, toAdminPendingPaymentOutput);
  }

  async adminTaskCounts(accountId: bigint): Promise<AdminTaskCountsOutput> {
    await this.requireAdminContext(accountId);
    const [
      claimedPayments,
      pendingPayments,
      refundsAwaitingAccount,
      refundsAwaitingTransfer,
    ] = await Promise.all([
      this.payments.countPendingPayments({ claimedOnly: true }),
      this.payments.countPendingPayments({ claimedOnly: false }),
      this.refunds.countRefunds({ status: RefundStatus.AWAITING_ACCOUNT }),
      this.refunds.countRefunds({ status: RefundStatus.AWAITING_TRANSFER }),
    ]);
    return {
      claimedPayments,
      pendingPayments,
      refundsAwaitingAccount,
      refundsAwaitingTransfer,
    };
  }

  async adminConfirmPayment(
    accountId: bigint,
    input: AdminConfirmPaymentInput,
  ): Promise<AdminOrderSummaryOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const orderId = parseId(input.orderId);
    const { depositedAmount } = input;
    if (!Number.isSafeInteger(depositedAmount) || depositedAmount < 0) {
      throw new DomainException('DEPOSIT_AMOUNT_INVALID');
    }
    const note = cleanNullableText(input.note, MAX_CONFIRM_NOTE_LENGTH);
    const now = this.clock.now();

    const updated = await this.transitions.confirmPayment({
      orderId,
      source: PaymentConfirmSource.ADMIN,
      actorAccountId: ctx.accountId,
      actorLabel: ctx.displayLabel,
      depositedAmount,
      note,
      now,
      assertConfirmable: (state) =>
        assertPaymentConfirmable(state, depositedAmount, now),
    });
    if (!updated) throw new DomainException('ORDER_NOT_FOUND');

    const [firstItem] = updated.items;
    if (firstItem) {
      await this.events.publishSellerOrderUpdate(
        firstItem.store_id,
        toSellerOrderUpdateEvent('SUBMITTED', updated),
      );
    }
    return toAdminOrderSummaryOutput(updated);
  }
}
