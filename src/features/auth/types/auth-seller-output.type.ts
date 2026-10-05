import type { AccountStatus } from '@/generated/prisma/client';

export interface SellerAccountOutput {
  accountId: string;
  username: string | null;
  displayName: string | null;
  storeId: string | null;
  mustChangePassword: boolean;
  accountStatus: AccountStatus;
}
