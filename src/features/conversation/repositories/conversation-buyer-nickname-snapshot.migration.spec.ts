import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 판매자 읽음 마커 마이그레이션의 닉네임 백필 SQL을 그대로 실행해, 활성 프로필만 현재 닉네임으로 채워지는지 본다.
// 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20261005135631_conversation_seller_read_marker/migration.sql',
);

function backfillStatements(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const body = sql.slice(
    sql.indexOf('-- backfill'),
    sql.indexOf('-- end backfill'),
  );
  return body
    .split(';')
    .map((stmt) => stmt.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter((stmt) => stmt.length > 0);
}

describe('store_conversation 구매자 닉네임 스냅샷 백필 (real DB)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = await createTestingModuleWithRealDb({ providers: [] }));
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function runBackfill(): Promise<void> {
    const statements = backfillStatements();
    expect(statements).toHaveLength(1);
    for (const stmt of statements) await prisma.$executeRawUnsafe(stmt);
  }

  async function createConversation(args: {
    nickname: string;
    profileDeletedAt?: Date | null;
  }) {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, {
      account_id: account.id,
      nickname: args.nickname,
    });
    if (args.profileDeletedAt) {
      await prisma.userProfile.update({
        where: { account_id: account.id },
        data: { deleted_at: args.profileDeletedAt },
      });
    }
    const store = await createStore(prisma);
    return prisma.storeConversation.create({
      data: { account_id: account.id, store_id: store.id },
    });
  }

  async function snapshotOf(id: bigint): Promise<string | null> {
    const row = await prisma.storeConversation.findUniqueOrThrow({
      where: { id },
    });
    return row.buyer_nickname_snapshot;
  }

  it('활성 프로필의 닉네임만 채우고, 탈퇴 프로필·빈 닉네임은 null로 남긴다', async () => {
    const active = await createConversation({ nickname: '현진' });
    // 탈퇴는 닉네임 덮어쓰기(deleted_<id>)와 deleted_at을 같은 트랜잭션에 쓴다 — 조인 조건만으로 빠진다
    const withdrawn = await createConversation({
      nickname: 'deleted_42',
      profileDeletedAt: new Date(),
    });
    const empty = await createConversation({ nickname: '' });

    // 대상 수 선확인: 마이그레이션 전 상태(스냅샷 전부 null)
    expect(
      await prisma.storeConversation.count({
        where: { buyer_nickname_snapshot: null },
      }),
    ).toBe(3);

    await runBackfill();

    expect(await snapshotOf(active.id)).toBe('현진');
    expect(await snapshotOf(withdrawn.id)).toBeNull();
    expect(await snapshotOf(empty.id)).toBeNull();
  });

  it('반증: 활성 프로필의 deleted_ 접두 닉네임은 그대로 채워진다(접두어 가드 없음)', async () => {
    const conv = await createConversation({ nickname: 'deleted_abc' });

    await runBackfill();

    expect(await snapshotOf(conv.id)).toBe('deleted_abc');
  });
});
