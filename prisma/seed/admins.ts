/**
 * 관리자 시드. env ADMIN_SEED_USERNAME / ADMIN_SEED_PASSWORD가 둘 다 있을 때만 1개 만든다 —
 * 비밀번호를 레포에 두지 않기 위해서다. 이메일은 SEED_ADMIN_EMAIL_PREFIX로 시작해
 * resetSeedScope가 자기 영역만 정리한다.
 */
import argon2 from 'argon2';

import { assertSeedCredential } from './credential-policy';
import { SEED_ADMIN_EMAIL_PREFIX } from './idempotent';

import type { PrismaClient } from '@/generated/prisma/client';

export async function seedAdmins(prisma: PrismaClient): Promise<void> {
  const username = process.env.ADMIN_SEED_USERNAME?.trim();
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!username || !password) {
    console.log(
      '[seed]   ADMIN_SEED_USERNAME/ADMIN_SEED_PASSWORD 미설정 — 관리자 시드 생략',
    );
    return;
  }

  assertSeedCredential({ username, password });

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
      username,
      password_hash: await argon2.hash(password, { type: argon2.argon2id }),
      // 시드 비밀번호는 운영자가 직접 고른 값이라 변경 강제하지 않는다.
      must_change_password: false,
    },
  });
  // username은 env에서 온 값이라 로그에 남기지 않는다(CodeQL: clear-text logging)
  console.log(`[seed]   관리자 accountId=${admin.id.toString()}`);
}
