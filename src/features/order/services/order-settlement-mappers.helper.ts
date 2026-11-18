import { formatDateOnly } from '@/common/utils/kst-time';
import {
  confirmedPaidAmount,
  settlementAmounts,
} from '@/features/order/repositories/order-settlement-finalizer.helper';
import type {
  MonthlyCommissionRow,
  SettlementDetailRow,
} from '@/features/order/repositories/settlement.repository';
import {
  maskAccountNumber,
  toBank,
} from '@/features/order/services/order-bank-account.helper';
import type { AdminStoreSettlementAccountOutput } from '@/features/order/types/order-payment-output.type';
import type {
  AdminMonthlyCommissionReportOutput,
  AdminSettlementDetailOutput,
  AdminSettlementSummaryOutput,
  OrderSettlementFieldsOutput,
  SellerSettlementDetailOutput,
  SellerSettlementSummaryOutput,
  SettlementOrderOutput,
  SettlementPaidAccountOutput,
} from '@/features/order/types/order-settlement-output.type';
import { OrderStatus, type Settlement } from '@/generated/prisma/client';

/**
 * 확정 뒤에는 실제 지급액, 확정 전에는 결제액에서 그 주문의 수수료율로 미리 계산한 값이다.
 * 확인된 결제가 없으면 null, 확정 없이 취소된 주문(전액 환불)은 정산되지 않으니 0이다.
 */
export function toOrderSettlementFields(row: {
  status: OrderStatus;
  commission_rate_bps: number;
  settlement_base_amount: number | null;
  commission_amount: number | null;
  payment: { amount: number; confirmed_at: Date | null } | null;
}): OrderSettlementFieldsOutput {
  let expectedPayoutAmount: number | null = null;
  if (row.settlement_base_amount !== null) {
    expectedPayoutAmount =
      row.settlement_base_amount - (row.commission_amount ?? 0);
  } else if (row.payment?.confirmed_at) {
    expectedPayoutAmount =
      row.status === OrderStatus.CANCELED
        ? 0
        : settlementAmounts(
            confirmedPaidAmount(row.payment),
            row.commission_rate_bps,
          ).payoutAmount;
  }
  return {
    commissionRateBps: row.commission_rate_bps,
    expectedPayoutAmount,
    settlementBaseAmount: row.settlement_base_amount,
    commissionAmount: row.commission_amount,
  };
}

function toPaidAccount(row: Settlement): SettlementPaidAccountOutput | null {
  if (
    !row.paid_bank_code ||
    !row.paid_account_holder ||
    !row.paid_account_last4
  ) {
    return null;
  }
  return {
    bank: toBank(row.paid_bank_code),
    accountHolder: row.paid_account_holder,
    accountNumberMasked: maskAccountNumber(row.paid_account_last4),
  };
}

function toSettlementOrders(row: SettlementDetailRow): SettlementOrderOutput[] {
  return row.orders.map((order) => {
    const base = order.settlement_base_amount ?? 0;
    const commission = order.commission_amount ?? 0;
    return {
      orderId: order.id.toString(),
      orderNumber: order.order_number,
      productName: order.items[0]?.product_name_snapshot ?? null,
      status: order.status,
      commissionRateBps: order.commission_rate_bps,
      settlementBaseAmount: base,
      commissionAmount: commission,
      payoutAmount: base - commission,
      // 정산에 묶인 주문은 확정된 주문뿐이다
      settlementFinalizedAt: order.settlement_finalized_at!,
    };
  });
}

export function toSellerSettlementSummaryOutput(
  row: Settlement,
): SellerSettlementSummaryOutput {
  return {
    id: row.id.toString(),
    periodStart: formatDateOnly(row.period_start),
    periodEnd: formatDateOnly(row.period_end),
    orderCount: row.order_count,
    settlementBaseAmount: row.settlement_base_amount,
    commissionAmount: row.commission_amount,
    payoutAmount: row.payout_amount,
    status: row.status,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  };
}

export function toSellerSettlementDetailOutput(
  row: SettlementDetailRow,
): SellerSettlementDetailOutput {
  return {
    ...toSellerSettlementSummaryOutput(row),
    paidAccount: toPaidAccount(row),
    orders: toSettlementOrders(row),
  };
}

export function toAdminSettlementSummaryOutput(
  row: Settlement,
  accountRegistered: boolean,
): AdminSettlementSummaryOutput {
  return {
    ...toSellerSettlementSummaryOutput(row),
    storeId: row.store_id.toString(),
    storeName: row.store_name_snapshot,
    accountRegistered,
  };
}

export function toAdminSettlementDetailOutput(
  row: SettlementDetailRow,
  currentAccount: AdminStoreSettlementAccountOutput | null,
): AdminSettlementDetailOutput {
  return {
    ...toAdminSettlementSummaryOutput(row, currentAccount !== null),
    paidByLabel: row.paid_by_label_snapshot,
    paidNote: row.paid_note,
    paidAccount: toPaidAccount(row),
    currentAccount,
    orders: toSettlementOrders(row),
  };
}

export function toAdminMonthlyCommissionReport(
  month: string,
  rows: MonthlyCommissionRow[],
): AdminMonthlyCommissionReportOutput {
  const total = (pick: (row: MonthlyCommissionRow) => number) =>
    rows.reduce((sum, row) => sum + pick(row), 0);
  return {
    month,
    orderCount: total((row) => row.orderCount),
    settlementBaseAmount: total((row) => row.settlementBaseAmount),
    commissionAmount: total((row) => row.commissionAmount),
    stores: rows.map((row) => ({
      storeId: row.storeId.toString(),
      storeName: row.storeName,
      orderCount: row.orderCount,
      settlementBaseAmount: row.settlementBaseAmount,
      commissionAmount: row.commissionAmount,
    })),
  };
}
