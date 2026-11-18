import type { OrderRefundOutput } from '@/features/order/types/order-output.type';
import type {
  DepositRecordKind,
  RefundStatus,
} from '@/generated/prisma/client';

export interface AdminRefundOutput extends OrderRefundOutput {
  orderId: string;
  orderNumber: string;
  buyerName: string;
  buyerPhone: string;
  storeName: string | null;
  productName: string | null;
  completedByLabel: string | null;
  completeNote: string | null;
}

export interface AdminDepositRecordOutput {
  id: string;
  kind: DepositRecordKind;
  orderId: string | null;
  orderNumber: string | null;
  amount: number;
  depositorName: string;
  depositedAt: Date | null;
  note: string | null;
  recordedByLabel: string | null;
  refundId: string | null;
  refundStatus: RefundStatus | null;
  createdAt: Date;
}

export interface AdminRefundDetailOutput {
  refund: AdminRefundOutput;
  /** 원문. 관리자 상세에서만 복호화해 내려준다. 계좌 입력 전이면 null. */
  accountNumber: string | null;
  depositRecord: AdminDepositRecordOutput | null;
}
