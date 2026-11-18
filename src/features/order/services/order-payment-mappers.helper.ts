import type { PaymentSettingRow } from '@/features/order/repositories/payment-setting.repository';
import type {
  OrderPaymentRow,
  PendingPaymentRow,
} from '@/features/order/repositories/payment.repository';
import {
  maskAccountNumber,
  toBank,
} from '@/features/order/services/order-bank-account.helper';
import type {
  AdminOrderPaymentOutput,
  AdminPaymentSettingOutput,
  AdminPendingPaymentOutput,
  AdminStoreSettlementAccountOutput,
  OrderPaymentOutput,
  SellerSettlementAccountOutput,
} from '@/features/order/types/order-payment-output.type';
import type {
  Payment,
  StoreSettlementAccount,
} from '@/generated/prisma/client';

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

export function toOrderPaymentOutput(row: OrderPaymentRow): OrderPaymentOutput {
  return {
    method: row.method,
    status: row.status,
    amount: row.amount,
    depositorName: row.depositor_name,
    depositBank: toBank(row.deposit_bank_code),
    depositAccountNumber: row.deposit_account_number,
    depositAccountHolder: row.deposit_account_holder,
    expiresAt: row.expires_at,
    buyerClaimedAt: row.buyer_claimed_at,
    confirmedAt: row.confirmed_at,
    confirmSource: row.confirm_source,
  };
}

export function toAdminOrderPaymentOutput(
  row: Payment,
): AdminOrderPaymentOutput {
  return {
    ...toOrderPaymentOutput(row),
    confirmedByLabel: row.confirmed_by_label_snapshot,
    confirmNote: row.confirm_note,
  };
}

export function toAdminPendingPaymentOutput(
  row: PendingPaymentRow,
): AdminPendingPaymentOutput {
  const [firstItem] = row.order.items;
  return {
    orderId: row.order.id.toString(),
    orderNumber: row.order.order_number,
    storeName: firstItem?.store_name_snapshot ?? null,
    productName: firstItem?.product_name_snapshot ?? null,
    amount: row.amount,
    depositorName: row.depositor_name,
    buyerName: row.order.buyer_name,
    buyerPhone: row.order.buyer_phone,
    createdAt: row.order.created_at,
    expiresAt: row.expires_at,
    buyerClaimedAt: row.buyer_claimed_at,
    pickupAt: row.order.pickup_at,
  };
}
