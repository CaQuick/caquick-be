import type {
  AdminStoreSettlementAccountOutput,
  BankOutput,
} from '@/features/order/types/order-payment-output.type';
import type { OrderStatus, SettlementStatus } from '@/generated/prisma/client';

/** 주문 상세(판매자·관리자)의 수수료·정산 표시. */
export interface OrderSettlementFieldsOutput {
  commissionRateBps: number;
  expectedPayoutAmount: number | null;
  settlementBaseAmount: number | null;
  commissionAmount: number | null;
}

export interface SettlementPaidAccountOutput {
  bank: BankOutput;
  accountHolder: string;
  accountNumberMasked: string;
}

export interface SettlementOrderOutput {
  orderId: string;
  orderNumber: string;
  productName: string | null;
  status: OrderStatus;
  commissionRateBps: number;
  settlementBaseAmount: number;
  commissionAmount: number;
  payoutAmount: number;
  settlementFinalizedAt: Date;
}

export interface SellerSettlementSummaryOutput {
  id: string;
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  settlementBaseAmount: number;
  commissionAmount: number;
  payoutAmount: number;
  status: SettlementStatus;
  paidAt: Date | null;
  createdAt: Date;
}

export interface SellerSettlementDetailOutput extends SellerSettlementSummaryOutput {
  paidAccount: SettlementPaidAccountOutput | null;
  orders: SettlementOrderOutput[];
}

export interface AdminSettlementSummaryOutput extends SellerSettlementSummaryOutput {
  storeId: string;
  storeName: string;
  accountRegistered: boolean;
}

export interface AdminSettlementDetailOutput extends AdminSettlementSummaryOutput {
  paidByLabel: string | null;
  paidNote: string | null;
  paidAccount: SettlementPaidAccountOutput | null;
  /** 원문. 관리자 상세에서만 복호화해 내려준다. */
  currentAccount: AdminStoreSettlementAccountOutput | null;
  orders: SettlementOrderOutput[];
}

export interface AdminMonthlyCommissionStoreOutput {
  storeId: string;
  storeName: string;
  orderCount: number;
  settlementBaseAmount: number;
  commissionAmount: number;
}

export interface AdminMonthlyCommissionReportOutput {
  month: string;
  orderCount: number;
  settlementBaseAmount: number;
  commissionAmount: number;
  stores: AdminMonthlyCommissionStoreOutput[];
}
