import { Inject, Injectable } from '@nestjs/common';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  kstDayBoundaries,
  kstMidnightUtc,
  parseKstDate,
  parseKstYearMonth,
} from '@/common/utils/kst-time';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
  toCursorConnection,
} from '@/common/utils/pagination';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import type { AdminMarkSettlementPaidInput } from '@/features/order/dto/inputs/admin-mark-settlement-paid.input';
import type { AdminMonthlyCommissionInput } from '@/features/order/dto/inputs/admin-monthly-commission.input';
import type { AdminSettlementListInput } from '@/features/order/dto/inputs/admin-settlement-list.input';
import { SettlementRepository } from '@/features/order/repositories/settlement.repository';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import { toAdminStoreSettlementAccountOutput } from '@/features/order/services/order-payment-mappers.helper';
import {
  toAdminMonthlyCommissionReport,
  toAdminSettlementDetailOutput,
  toAdminSettlementSummaryOutput,
} from '@/features/order/services/order-settlement-mappers.helper';
import type {
  AdminMonthlyCommissionReportOutput,
  AdminSettlementDetailOutput,
  AdminSettlementSummaryOutput,
} from '@/features/order/types/order-settlement-output.type';
import { AccountCipher } from '@/global/crypto/account-cipher.service';

const PAID_ERRORS = {
  'not-found': 'SETTLEMENT_NOT_FOUND',
  'already-paid': 'SETTLEMENT_ALREADY_PAID',
  'account-required': 'SETTLEMENT_ACCOUNT_REQUIRED',
} as const;

/** 주간 정산 조회·송금 완료와 월 수수료 집계. 계좌번호 원문은 정산 상세의 현재 계좌에서만 복호화한다. */
@Injectable()
export class AdminSettlementService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly settlements: SettlementRepository,
    private readonly settlementAccounts: StoreSettlementAccountRepository,
    private readonly cipher: AccountCipher,
    private readonly clock: ClockService,
  ) {
    super(accounts, auditLogs);
  }

  async adminSettlements(
    accountId: bigint,
    input?: AdminSettlementListInput,
  ): Promise<CursorConnection<AdminSettlementSummaryOutput>> {
    await this.requireAdminContext(accountId);
    // 관리자 FE는 '전체'를 null로 보낸다 — 생략과 같다
    const filter = {
      status: input?.status ?? undefined,
      storeId: parseOptionalId(input?.storeId) ?? undefined,
      periodStart:
        input?.periodStart == null
          ? undefined
          : parseDateOnly(input.periodStart),
    };
    const normalized = normalizeCursorInput({
      limit: input?.limit,
      cursor: input?.cursor == null ? null : parseIdCursor(input.cursor),
    });
    const [rows, totalCount] = await Promise.all([
      this.settlements.list({ ...filter, ...normalized }),
      this.settlements.count(filter),
    ]);
    const page = sliceIdCursorPage(rows, normalized.limit);
    const registered = await this.settlementAccounts.findStoreIdsWithAccount(
      page.items.map((row) => row.store_id),
    );
    return toCursorConnection(page, totalCount, (row) =>
      toAdminSettlementSummaryOutput(row, registered.has(row.store_id)),
    );
  }

  async adminSettlement(
    accountId: bigint,
    settlementId: bigint,
  ): Promise<AdminSettlementDetailOutput> {
    await this.requireAdminContext(accountId);
    return this.detailOf(settlementId);
  }

  async adminMarkSettlementPaid(
    accountId: bigint,
    input: AdminMarkSettlementPaidInput,
  ): Promise<AdminSettlementDetailOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const settlementId = parseId(input.settlementId);
    const result = await this.settlements.markPaid({
      settlementId,
      actorAccountId: ctx.accountId,
      actorLabel: ctx.displayLabel,
      note: cleanNullableText(input.note, MAX_REASON_LENGTH),
      now: this.clock.now(),
    });
    if (result.kind !== 'paid') {
      throw new DomainException(PAID_ERRORS[result.kind]);
    }
    return this.detailOf(settlementId);
  }

  async adminMonthlyCommissions(
    accountId: bigint,
    input: AdminMonthlyCommissionInput,
  ): Promise<AdminMonthlyCommissionReportOutput> {
    await this.requireAdminContext(accountId);
    const month = input.month.trim();
    const parsed = parseKstYearMonth(month);
    if (!parsed) throw new DomainException('INVALID_YEAR_MONTH');
    const rows = await this.settlements.monthlyCommissions(
      kstMidnightUtc(parsed.year, parsed.month, 1),
      kstMidnightUtc(parsed.year, parsed.month + 1, 1),
    );
    return toAdminMonthlyCommissionReport(month, rows);
  }

  private async detailOf(
    settlementId: bigint,
  ): Promise<AdminSettlementDetailOutput> {
    const row = await this.settlements.findDetail(settlementId);
    if (!row) throw new DomainException('SETTLEMENT_NOT_FOUND');
    const account = await this.settlementAccounts.findByStoreId(row.store_id);
    return toAdminSettlementDetailOutput(
      row,
      account
        ? toAdminStoreSettlementAccountOutput(
            account,
            this.cipher.decrypt(
              account.account_number_enc,
              'settlement-account',
            ),
          )
        : null,
    );
  }
}

/** YYYY-MM-DD(KST 달력일)을 `@db.Date` 비교값으로. */
function parseDateOnly(value: string): Date {
  const date = parseKstDate(value.trim());
  if (!date) throw new DomainException('INVALID_DATE');
  return kstDayBoundaries(date).dateOnlyUtc;
}
