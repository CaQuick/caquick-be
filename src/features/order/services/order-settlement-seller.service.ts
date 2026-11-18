import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
  toCursorConnection,
} from '@/common/utils/pagination';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import type { SellerSettlementListInput } from '@/features/order/dto/inputs/seller-settlement-list.input';
import type { SellerUpsertSettlementAccountInput } from '@/features/order/dto/inputs/seller-upsert-settlement-account.input';
import { SettlementRepository } from '@/features/order/repositories/settlement.repository';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import { normalizeBankAccount } from '@/features/order/services/order-bank-account.helper';
import { toSellerSettlementAccountOutput } from '@/features/order/services/order-payment-mappers.helper';
import {
  toSellerSettlementDetailOutput,
  toSellerSettlementSummaryOutput,
} from '@/features/order/services/order-settlement-mappers.helper';
import type { SellerSettlementAccountOutput } from '@/features/order/types/order-payment-output.type';
import type {
  SellerSettlementDetailOutput,
  SellerSettlementSummaryOutput,
} from '@/features/order/types/order-settlement-output.type';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import { OrderActor } from '@/generated/prisma/client';

/** 판매자 본인 정산 계좌와 주간 정산 내역. 계좌번호는 끝 4자리만 내려주고 원문은 복호화하지 않는다. */
@Injectable()
export class SellerSettlementService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly settlementAccounts: StoreSettlementAccountRepository,
    private readonly settlements: SettlementRepository,
  ) {
    super(repo, auditLogs);
  }

  async sellerSettlementAccount(
    accountId: bigint,
  ): Promise<SellerSettlementAccountOutput | null> {
    const ctx = await this.requireSellerContext(accountId);
    const row = await this.settlementAccounts.findByStoreId(ctx.storeId);
    return row ? toSellerSettlementAccountOutput(row) : null;
  }

  async sellerUpsertSettlementAccount(
    accountId: bigint,
    input: SellerUpsertSettlementAccountInput,
  ): Promise<SellerSettlementAccountOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const row = await this.settlementAccounts.upsertByStore({
      storeId: ctx.storeId,
      account: normalizeBankAccount(input),
      actorAccountId: ctx.accountId,
      actorRole: OrderActor.SELLER,
    });
    return toSellerSettlementAccountOutput(row);
  }

  async sellerSettlements(
    accountId: bigint,
    input?: SellerSettlementListInput,
  ): Promise<CursorConnection<SellerSettlementSummaryOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit,
      cursor: input?.cursor == null ? null : parseIdCursor(input.cursor),
    });
    const filter = { storeId: ctx.storeId };
    const [rows, totalCount] = await Promise.all([
      this.settlements.list({ ...filter, ...normalized }),
      this.settlements.count(filter),
    ]);
    return toCursorConnection(
      sliceIdCursorPage(rows, normalized.limit),
      totalCount,
      toSellerSettlementSummaryOutput,
    );
  }

  async sellerSettlement(
    accountId: bigint,
    settlementId: bigint,
  ): Promise<SellerSettlementDetailOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const row = await this.settlements.findDetail(settlementId, ctx.storeId);
    if (!row) throw new DomainException('SETTLEMENT_NOT_FOUND');
    return toSellerSettlementDetailOutput(row);
  }
}
