import type {
  OrderActor,
  PaymentConfirmSource,
  PaymentMethod,
  PaymentStatus,
} from '@/generated/prisma/client';

export interface BankOutput {
  code: string;
  name: string;
}

export interface AdminPaymentSettingOutput {
  commissionRateBps: number;
  depositBank: BankOutput | null;
  depositAccountNumber: string | null;
  depositAccountHolder: string | null;
  updatedAt: Date | null;
}

export interface SellerSettlementAccountOutput {
  bank: BankOutput;
  accountHolder: string;
  accountNumberMasked: string;
  updatedByRole: OrderActor;
  updatedAt: Date;
}

export interface AdminStoreSettlementAccountOutput extends SellerSettlementAccountOutput {
  storeId: string;
  /** 원문. 관리자 상세에서만 복호화해 내려준다. */
  accountNumber: string;
}

export interface OrderPaymentOutput {
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  depositorName: string;
  depositBank: BankOutput;
  depositAccountNumber: string;
  depositAccountHolder: string;
  expiresAt: Date;
  buyerClaimedAt: Date | null;
  confirmedAt: Date | null;
  confirmSource: PaymentConfirmSource | null;
}

export interface AdminOrderPaymentOutput extends OrderPaymentOutput {
  confirmedByLabel: string | null;
  confirmNote: string | null;
}

export interface AdminPendingPaymentOutput {
  orderId: string;
  orderNumber: string;
  storeName: string | null;
  productName: string | null;
  amount: number;
  depositorName: string;
  buyerName: string;
  buyerPhone: string;
  createdAt: Date;
  expiresAt: Date;
  buyerClaimedAt: Date | null;
  pickupAt: Date;
}

export interface AdminTaskCountsOutput {
  claimedPayments: number;
  pendingPayments: number;
}
