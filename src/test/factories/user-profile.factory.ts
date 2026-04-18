import type { PrismaClient, UserProfile } from '@prisma/client';

import { createAccount } from '@/test/factories/account.factory';
import { nextSeq } from '@/test/factories/sequence';

export interface UserProfileOverrides {
  account_id?: bigint;
  nickname?: string;
  birth_date?: Date | null;
  phone_number?: string | null;
  profile_image_url?: string | null;
  onboarding_completed_at?: Date | null;
}

export async function createUserProfile(
  prisma: PrismaClient,
  overrides: UserProfileOverrides = {},
): Promise<UserProfile> {
  const seq = nextSeq();
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;

  return prisma.userProfile.create({
    data: {
      account_id: accountId,
      nickname: overrides.nickname ?? `nickname_${seq}`,
      birth_date: overrides.birth_date ?? null,
      phone_number: overrides.phone_number ?? null,
      profile_image_url: overrides.profile_image_url ?? null,
      onboarding_completed_at:
        overrides.onboarding_completed_at === undefined
          ? new Date()
          : overrides.onboarding_completed_at,
    },
  });
}
