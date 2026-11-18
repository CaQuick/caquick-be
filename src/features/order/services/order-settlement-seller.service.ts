import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import type { SellerUpsertSettlementAccountInput } from '@/features/order/dto/inputs/seller-upsert-settlement-account.input';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import { normalizeBankAccount } from '@/features/order/services/order-bank-account.helper';
import { toSellerSettlementAccountOutput } from '@/features/order/services/order-payment-mappers.helper';
import type { SellerSettlementAccountOutput } from '@/features/order/types/order-payment-output.type';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import { OrderActor } from '@/generated/prisma/client';

/** 판매자 본인 정산 계좌. 계좌번호는 끝 4자리만 내려주고 원문은 복호화하지 않는다. */
@Injectable()
export class SellerSettlementService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly settlementAccounts: StoreSettlementAccountRepository,
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
}
