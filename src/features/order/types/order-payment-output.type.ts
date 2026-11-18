import type { OrderActor } from '@/generated/prisma/client';

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
