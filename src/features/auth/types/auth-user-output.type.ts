import type { AccountType, IdentityProvider } from '@/generated/prisma/client';

export interface UserProfileOutput {
  nickname: string;
  birthDate: Date | null;
  phoneNumber: string | null;
  profileImageUrl: string | null;
  onboardingCompletedAt: Date | null;
}

export interface LinkedIdentityOutput {
  provider: IdentityProvider;
  lastLoginAt: Date | null;
}

export interface MePayload {
  accountId: string;
  email: string | null;
  name: string | null;
  accountType: AccountType;
  profile: UserProfileOutput;
  linkedIdentities: LinkedIdentityOutput[];
}

export interface NicknameAvailability {
  available: boolean;
  reason: string | null;
}
