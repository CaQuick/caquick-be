import type {
  AccountStatus,
  AccountType,
  IdentityProvider,
} from '@/generated/prisma/client';

export interface AdminAccountOutput {
  accountId: string;
  username: string | null;
  email: string | null;
  name: string | null;
  status: AccountStatus;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AdminUserOutput {
  accountId: string;
  email: string | null;
  name: string | null;
  status: AccountStatus;
  nickname: string | null;
  phoneNumber: string | null;
  onboardingCompleted: boolean;
  identityProviders: IdentityProvider[];
  orderCount: number;
  reviewCount: number;
  createdAt: Date;
}

export interface AdminAccountStatusResultOutput {
  accountId: string;
  accountType: AccountType;
  status: AccountStatus;
}
