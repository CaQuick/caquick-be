import type { PaymentSettingRow } from '@/features/order/repositories/payment-setting.repository';
import {
  maskAccountNumber,
  toBank,
} from '@/features/order/services/order-bank-account.helper';
import type {
  AdminPaymentSettingOutput,
  AdminStoreSettlementAccountOutput,
  SellerSettlementAccountOutput,
} from '@/features/order/types/order-payment-output.type';
import type { StoreSettlementAccount } from '@/generated/prisma/client';

export function toAdminPaymentSettingOutput(
  row: PaymentSettingRow,
): AdminPaymentSettingOutput {
  return {
    commissionRateBps: row.commission_rate_bps,
    depositBank: row.deposit_bank_code ? toBank(row.deposit_bank_code) : null,
    depositAccountNumber: row.deposit_account_number,
    depositAccountHolder: row.deposit_account_holder,
    updatedAt: row.updated_at,
  };
}

export function toSellerSettlementAccountOutput(
  row: StoreSettlementAccount,
): SellerSettlementAccountOutput {
  return {
    bank: toBank(row.bank_code),
    accountHolder: row.account_holder,
    accountNumberMasked: maskAccountNumber(row.account_number_last4),
    updatedByRole: row.updated_by_role,
    updatedAt: row.updated_at,
  };
}

export function toAdminStoreSettlementAccountOutput(
  row: StoreSettlementAccount,
  accountNumber: string,
): AdminStoreSettlementAccountOutput {
  return {
    ...toSellerSettlementAccountOutput(row),
    storeId: row.store_id.toString(),
    accountNumber,
  };
}
