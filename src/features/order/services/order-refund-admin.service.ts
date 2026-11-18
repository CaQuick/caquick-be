import { Inject, Injectable } from '@nestjs/common';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
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
  sliceIdCursorPage,
  toCursorConnection,
} from '@/common/utils/pagination';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import type { AdminCompleteRefundInput } from '@/features/order/dto/inputs/admin-complete-refund.input';
import type { AdminCreateDepositReturnInput } from '@/features/order/dto/inputs/admin-create-deposit-return.input';
import type { AdminDepositRecordListInput } from '@/features/order/dto/inputs/admin-deposit-record-list.input';
import type { AdminLinkUnidentifiedDepositInput } from '@/features/order/dto/inputs/admin-link-unidentified-deposit.input';
import type { AdminRecordUnidentifiedDepositInput } from '@/features/order/dto/inputs/admin-record-unidentified-deposit.input';
import type { AdminRefundListInput } from '@/features/order/dto/inputs/admin-refund-list.input';
import {
  DepositRecordRepository,
  type DepositRecordInput,
} from '@/features/order/repositories/deposit-record.repository';
import { RefundRepository } from '@/features/order/repositories/refund.repository';
import {
  toAdminDepositRecordOutput,
  toAdminRefundDetailOutput,
  toAdminRefundOutput,
} from '@/features/order/services/order-refund-mappers.helper';
import type {
  AdminDepositRecordOutput,
  AdminRefundDetailOutput,
  AdminRefundOutput,
} from '@/features/order/types/order-refund-output.type';
import { AccountCipher } from '@/global/crypto/account-cipher.service';

/** 입금 기록의 입금자명은 은행 앱 표기 그대로라 결제 입금자명(20자)보다 길게 받는다. */
const MAX_DEPOSITOR_NAME_LENGTH = 50;

/**
 * 관리자 환불 송금·입금 기록. 돌려줄 입금은 주문에 연결해 환불을 만들고, 주인 모를 입금은 메모로 종결한다.
 * 환불 계좌번호 원문 복호화는 환불 상세(adminRefund)에서만 한다.
 */
@Injectable()
export class AdminRefundService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly refunds: RefundRepository,
    private readonly depositRecords: DepositRecordRepository,
    private readonly cipher: AccountCipher,
    private readonly clock: ClockService,
  ) {
    super(accounts, auditLogs);
  }

  async adminRefunds(
    accountId: bigint,
    input?: AdminRefundListInput,
  ): Promise<CursorConnection<AdminRefundOutput>> {
    await this.requireAdminContext(accountId);
    // 관리자 FE는 '전체'를 null로 보낸다 — 생략과 같다
    const filter = {
      status: input?.status ?? undefined,
      kind: input?.kind ?? undefined,
    };
    const { limit } = normalizeCursorInput({ limit: input?.limit });
    const cursor = input?.cursor;
    const [rows, totalCount] = await Promise.all([
      this.refunds.listRefunds({
        ...filter,
        limit,
        ...(cursor == null ? {} : { cursor: parseIdCursor(cursor) }),
      }),
      this.refunds.countRefunds(filter),
    ]);
    return toCursorConnection(
      sliceIdCursorPage(rows, limit),
      totalCount,
      toAdminRefundOutput,
    );
  }

  async adminRefund(
    accountId: bigint,
    refundId: bigint,
  ): Promise<AdminRefundDetailOutput> {
    await this.requireAdminContext(accountId);
    const row = await this.refunds.findAdminRefund(refundId);
    if (!row) throw new DomainException('REFUND_NOT_FOUND');
    return toAdminRefundDetailOutput(
      row,
      row.account_number_enc
        ? this.cipher.decrypt(row.account_number_enc, 'refund-account')
        : null,
    );
  }

  async adminCompleteRefund(
    accountId: bigint,
    input: AdminCompleteRefundInput,
  ): Promise<AdminRefundOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const result = await this.refunds.complete({
      refundId: parseId(input.refundId),
      actorAccountId: ctx.accountId,
      actorLabel: ctx.displayLabel,
      note: cleanNullableText(input.note, MAX_REASON_LENGTH),
      now: this.clock.now(),
    });
    if (result === 'not-found') throw new DomainException('REFUND_NOT_FOUND');
    if (result === 'completed') {
      throw new DomainException('REFUND_ALREADY_COMPLETED');
    }
    if (result === 'not-ready') throw new DomainException('REFUND_NOT_READY');
    return toAdminRefundOutput(result);
  }

  async adminDepositRecords(
    accountId: bigint,
    input?: AdminDepositRecordListInput,
  ): Promise<CursorConnection<AdminDepositRecordOutput>> {
    await this.requireAdminContext(accountId);
    const kind = input?.kind ?? undefined;
    const { limit } = normalizeCursorInput({ limit: input?.limit });
    const cursor = input?.cursor;
    const [rows, totalCount] = await Promise.all([
      this.depositRecords.listDepositRecords({
        kind,
        limit,
        ...(cursor == null ? {} : { cursor: parseTimestampIdCursor(cursor) }),
      }),
      this.depositRecords.countDepositRecords(kind),
    ]);
    const page = sliceCursorPage(rows, limit, (last) =>
      buildTimestampIdCursor(last.created_at, last.id),
    );
    return toCursorConnection(page, totalCount, toAdminDepositRecordOutput);
  }

  /** 주문 상태와 관계없이 그 주문의 구매자에게 입금액 전액을 돌려준다(주문·결제·정산은 그대로). */
  async adminCreateDepositReturn(
    accountId: bigint,
    input: AdminCreateDepositReturnInput,
  ): Promise<AdminDepositRecordOutput> {
    const deposit = await this.depositInput(accountId, input);
    const record = await this.depositRecords.createReturn({
      ...deposit,
      orderId: parseId(input.orderId),
    });
    if (!record) throw new DomainException('ORDER_NOT_FOUND');
    return toAdminDepositRecordOutput(record);
  }

  async adminRecordUnidentifiedDeposit(
    accountId: bigint,
    input: AdminRecordUnidentifiedDepositInput,
  ): Promise<AdminDepositRecordOutput> {
    const deposit = await this.depositInput(accountId, input);
    if (!deposit.note) throw new DomainException('DEPOSIT_NOTE_REQUIRED');
    return toAdminDepositRecordOutput(
      await this.depositRecords.recordUnidentified(deposit),
    );
  }

  async adminLinkUnidentifiedDeposit(
    accountId: bigint,
    input: AdminLinkUnidentifiedDepositInput,
  ): Promise<AdminDepositRecordOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const result = await this.depositRecords.linkToOrder({
      depositRecordId: parseId(input.depositRecordId),
      orderId: parseId(input.orderId),
      actorAccountId: ctx.accountId,
      now: this.clock.now(),
    });
    if (result === 'order-not-found') {
      throw new DomainException('ORDER_NOT_FOUND');
    }
    if (result === 'record-not-found') {
      throw new DomainException('DEPOSIT_RECORD_NOT_FOUND');
    }
    if (result === 'already-linked') {
      throw new DomainException('DEPOSIT_RECORD_ALREADY_LINKED');
    }
    return toAdminDepositRecordOutput(result);
  }

  private async depositInput(
    accountId: bigint,
    input: {
      amount: number;
      depositorName: string;
      depositedAt?: Date | null;
      note?: string | null;
    },
  ): Promise<DepositRecordInput> {
    const ctx = await this.requireAdminContext(accountId);
    if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
      throw new DomainException('DEPOSIT_AMOUNT_INVALID');
    }
    return {
      amount: input.amount,
      depositorName: cleanRequiredText(
        input.depositorName,
        MAX_DEPOSITOR_NAME_LENGTH,
      ),
      depositedAt: input.depositedAt ?? null,
      note: cleanNullableText(input.note, MAX_REASON_LENGTH),
      actorAccountId: ctx.accountId,
      actorLabel: ctx.displayLabel,
      now: this.clock.now(),
    };
  }
}
