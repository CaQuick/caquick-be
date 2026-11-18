import { Inject, Injectable } from '@nestjs/common';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import type { AdminUpdatePaymentSettingInput } from '@/features/order/dto/inputs/admin-update-payment-setting.input';
import type { AdminUpsertStoreSettlementAccountInput } from '@/features/order/dto/inputs/admin-upsert-store-settlement-account.input';
import {
  PaymentSettingRepository,
  type PaymentSettingValues,
} from '@/features/order/repositories/payment-setting.repository';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import {
  normalizeAccountHolder,
  normalizeAccountNumber,
  normalizeBankAccount,
  normalizeBankCode,
} from '@/features/order/services/order-bank-account.helper';
import {
  toAdminPaymentSettingOutput,
  toAdminStoreSettlementAccountOutput,
} from '@/features/order/services/order-payment-mappers.helper';
import type {
  AdminPaymentSettingOutput,
  AdminStoreSettlementAccountOutput,
} from '@/features/order/types/order-payment-output.type';
import { StoreAdminRepository } from '@/features/store';
import { OrderActor } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';

const MAX_COMMISSION_RATE_BPS = 10_000;

/** 플랫폼 결제 설정과 매장 정산 계좌 관리. 계좌번호 원문 복호화는 관리자 매장 정산 계좌 조회에서만 한다. */
@Injectable()
export class AdminPaymentService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly paymentSettings: PaymentSettingRepository,
    private readonly settlementAccounts: StoreSettlementAccountRepository,
    private readonly stores: StoreAdminRepository,
    private readonly cipher: AccountCipher,
  ) {
    super(accounts, auditLogs);
  }

  async adminPaymentSetting(
    accountId: bigint,
  ): Promise<AdminPaymentSettingOutput> {
    await this.requireAdminContext(accountId);
    return toAdminPaymentSettingOutput(
      await this.paymentSettings.findPaymentSetting(),
    );
  }

  async adminUpdatePaymentSetting(
    accountId: bigint,
    input: AdminUpdatePaymentSettingInput,
  ): Promise<AdminPaymentSettingOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const reason = cleanRequiredText(input.reason, MAX_REASON_LENGTH);
    const patch: Partial<PaymentSettingValues> = {};
    if (input.commissionRateBps != null) {
      const bps = input.commissionRateBps;
      if (!Number.isInteger(bps) || bps < 0 || bps > MAX_COMMISSION_RATE_BPS) {
        throw new DomainException('INVALID_COMMISSION_RATE');
      }
      patch.commission_rate_bps = bps;
    }
    if (input.depositBankCode != null) {
      patch.deposit_bank_code = normalizeBankCode(input.depositBankCode);
    }
    if (input.depositAccountNumber != null) {
      patch.deposit_account_number = normalizeAccountNumber(
        input.depositAccountNumber,
      );
    }
    if (input.depositAccountHolder != null) {
      patch.deposit_account_holder = normalizeAccountHolder(
        input.depositAccountHolder,
      );
    }
    const row = await this.paymentSettings.updatePaymentSetting({
      patch,
      actorAccountId: ctx.accountId,
      reason,
    });
    return toAdminPaymentSettingOutput(row);
  }

  async adminStoreSettlementAccount(
    accountId: bigint,
    storeId: bigint,
  ): Promise<AdminStoreSettlementAccountOutput | null> {
    await this.requireAdminContext(accountId);
    await this.requireStore(storeId);
    const row = await this.settlementAccounts.findByStoreId(storeId);
    return row
      ? toAdminStoreSettlementAccountOutput(
          row,
          this.cipher.decrypt(row.account_number_enc, 'settlement-account'),
        )
      : null;
  }

  async adminUpsertStoreSettlementAccount(
    accountId: bigint,
    input: AdminUpsertStoreSettlementAccountInput,
  ): Promise<AdminStoreSettlementAccountOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const storeId = parseId(input.storeId);
    const account = normalizeBankAccount(input);
    const reason = cleanRequiredText(input.reason, MAX_REASON_LENGTH);
    await this.requireStore(storeId);
    const row = await this.settlementAccounts.upsertByStore({
      storeId,
      account,
      actorAccountId: ctx.accountId,
      actorRole: OrderActor.ADMIN,
      reason,
    });
    return toAdminStoreSettlementAccountOutput(row, account.accountNumber);
  }

  private async requireStore(storeId: bigint): Promise<void> {
    if (!(await this.stores.findStoreById(storeId))) {
      throw new DomainException('STORE_NOT_FOUND');
    }
  }
}
