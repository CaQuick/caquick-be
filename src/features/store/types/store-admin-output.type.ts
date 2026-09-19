import type { StoreOutput } from '@/features/store/types/store-record-output.type';
import type { AccountStatus } from '@/generated/prisma/client';

export type AdminStoreOutput = StoreOutput;

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
