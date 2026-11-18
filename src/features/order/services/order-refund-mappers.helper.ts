import type {
  AdminDepositRecordRow,
  AdminRefundRow,
} from '@/features/order/repositories/refund.repository';
import { toOrderRefund } from '@/features/order/services/order-output-mappers.helper';
import type {
  AdminDepositRecordOutput,
  AdminRefundDetailOutput,
  AdminRefundOutput,
} from '@/features/order/types/order-refund-output.type';

export function toAdminRefundOutput(row: AdminRefundRow): AdminRefundOutput {
  const [firstItem] = row.order.items;
  return {
    ...toOrderRefund(row),
    orderId: row.order_id.toString(),
    orderNumber: row.order.order_number,
    buyerName: row.order.buyer_name,
    buyerPhone: row.order.buyer_phone,
    storeName: firstItem?.store_name_snapshot ?? null,
    productName: firstItem?.product_name_snapshot ?? null,
    completedByLabel: row.completed_by_label_snapshot,
    completeNote: row.complete_note,
  };
}

export function toAdminRefundDetailOutput(
  row: AdminRefundRow,
  accountNumber: string | null,
): AdminRefundDetailOutput {
  return {
    refund: toAdminRefundOutput(row),
    accountNumber,
    depositRecord: row.deposit_record
      ? toAdminDepositRecordOutput(row.deposit_record)
      : null,
  };
}

export function toAdminDepositRecordOutput(
  row: AdminDepositRecordRow,
): AdminDepositRecordOutput {
  return {
    id: row.id.toString(),
    kind: row.kind,
    orderId: row.order_id?.toString() ?? null,
    orderNumber: row.order?.order_number ?? null,
    amount: row.amount,
    depositorName: row.depositor_name,
    depositedAt: row.deposited_at,
    note: row.note,
    recordedByLabel: row.recorded_by_label_snapshot,
    refundId: row.refund?.id.toString() ?? null,
    refundStatus: row.refund?.status ?? null,
    createdAt: row.created_at,
  };
}
