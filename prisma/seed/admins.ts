/**
 * 관리자 시드. 로컬 테스트용 관리자 1개(SEED_ADMIN_USERNAME / SEED_PASSWORD)를 만든다.
 * 이메일은 SEED_ADMIN_EMAIL_PREFIX로 시작해 resetSeedScope가 자기 영역만 정리한다.
 */
import argon2 from 'argon2';

import {
  SEED_ADMIN_USERNAME,
  SEED_PASSWORD,
  assertSeedCredential,
} from './credential-policy';
import { SEED_ADMIN_EMAIL_PREFIX } from './idempotent';

import type { PrismaClient } from '@/generated/prisma/client';

export async function seedAdmins(prisma: PrismaClient): Promise<void> {
  assertSeedCredential({
    username: SEED_ADMIN_USERNAME,
    password: SEED_PASSWORD,
  });

  const admin = await prisma.account.create({
    data: {
      account_type: 'ADMIN',
      status: 'ACTIVE',
      email: `${SEED_ADMIN_EMAIL_PREFIX}1@dev.caquick`,
      name: '시드 관리자',
    },
  });
  await prisma.accountCredential.create({
    data: {
      account_id: admin.id,
      username: SEED_ADMIN_USERNAME,
      password_hash: await argon2.hash(SEED_PASSWORD, {
        type: argon2.argon2id,
      }),
      // 로컬 테스트 계정이라 변경을 강제하지 않는다.
      must_change_password: false,
    },
  });
  console.log(
    `[seed]   관리자 accountId=${admin.id.toString()} (${SEED_ADMIN_USERNAME})`,
  );
}
