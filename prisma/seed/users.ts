/**
 * 시드 유저 + 프로필.
 *
 * - user1: 온보딩 완료 — 마이페이지 API 전반 검증의 메인 계정
 * - user2: 온보딩 미완료 — me.needsProfile=true 검증용
 */
import type { Account, PrismaClient } from '@prisma/client';

import { SEED_USER_EMAIL_PREFIX } from './idempotent';

export interface SeededUser extends Account {
  profileId: bigint;
}

export async function seedUsers(prisma: PrismaClient): Promise<SeededUser[]> {
  const now = new Date();

  const user1 = await prisma.account.create({
    data: {
      account_type: 'USER',
      status: 'ACTIVE',
      email: `${SEED_USER_EMAIL_PREFIX}1@dev.caquick`,
      name: '테스트 유저 1',
    },
  });
  const profile1 = await prisma.userProfile.create({
    data: {
      account_id: user1.id,
      nickname: 'seedTester1',
      birth_date: new Date(Date.UTC(1995, 4, 15)),
      phone_number: '010-1111-2222',
      onboarding_completed_at: now,
    },
  });

  const user2 = await prisma.account.create({
    data: {
      account_type: 'USER',
      status: 'ACTIVE',
      email: `${SEED_USER_EMAIL_PREFIX}2@dev.caquick`,
      name: null, // 이름 없음 → 온보딩 미완료
    },
  });
  // 미완료 사용자도 UserProfile은 1:1 필수일 수 있음 — schema에 unique account_id라 row는 있어야 함
  const profile2 = await prisma.userProfile.create({
    data: {
      account_id: user2.id,
      // nickname은 unique 필수 → 임시 nickname 부여
      nickname: 'seedTester2-tmp',
      onboarding_completed_at: null,
    },
  });

  return [
    { ...user1, profileId: profile1.id },
    { ...user2, profileId: profile2.id },
  ];
}
