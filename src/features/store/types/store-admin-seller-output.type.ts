import type { AccountStatus } from '@/generated/prisma/client';

export interface AdminSellerOutput {
  accountId: string;
  username: string | null;
  email: string | null;
  name: string | null;
  status: AccountStatus;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  profile: {
    businessName: string;
    businessPhone: string;
    websiteUrl: string | null;
  } | null;
  store: {
    id: string;
    storeName: string;
    storePhone: string;
    addressFull: string;
    isActive: boolean;
  } | null;
  createdAt: Date;
}
