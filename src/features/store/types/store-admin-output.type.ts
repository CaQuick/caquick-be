import type { StoreOutput } from '@/features/store/types/store-record-output.type';
import type { AccountStatus } from '@/generated/prisma/client';

export interface AdminStoreOutput extends StoreOutput {
  sellerLabel: string | null;
}

export interface AdminStoreDetailOutput {
  store: AdminStoreOutput;
  seller: {
    accountId: string;
    username: string | null;
    email: string | null;
    name: string | null;
    status: AccountStatus;
  };
  productCount: number;
  orderItemCount: number;
}
