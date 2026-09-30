import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatAccountLabel } from '@/common/utils/account-label';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createAccountCredential,
  createOrderItem,
  createReview,
  createReviewReport,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 관리자 표시값 스냅샷 마이그레이션의 백필 SQL을 그대로 실행해, 계정 라벨이 formatAccountLabel과 같은 규칙으로
// 채워지는지·탈퇴 신고자는 null로 남는지·리뷰 매장명이 주문 품목 스냅샷에서 오는지 본다. 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20261001023540_admin_display_snapshots/migration.sql',
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

type LabelCase = [
  string,
  { name: string | null; username: string | null; credentialDeleted: boolean },
  string | null,
];

// 이름·아이디 조합 전수(공백 이름·삭제된 자격증명 포함)
const LABEL_CASES: LabelCase[] = [
  [
    '이름과 아이디',
    { name: '이찬우', username: 'chanwoo7', credentialDeleted: false },
    '이찬우(chanwoo7)',
  ],
  [
    '이름만(자격증명 없음)',
    { name: '이찬우', username: null, credentialDeleted: false },
    '이찬우',
  ],
  [
    '아이디만',
    { name: null, username: 'chanwoo7', credentialDeleted: false },
    'chanwoo7',
  ],
  [
    '공백 이름은 없는 것으로',
    { name: '   ', username: 'chanwoo7', credentialDeleted: false },
    'chanwoo7',
  ],
  [
    '앞뒤 공백은 잘라서',
    { name: ' 이찬우 ', username: 'chanwoo7', credentialDeleted: false },
    '이찬우(chanwoo7)',
  ],
  [
    '삭제된 자격증명의 아이디는 쓰지 않음',
    { name: '이찬우', username: 'chanwoo7', credentialDeleted: true },
    '이찬우',
  ],
  [
    '둘 다 없음',
    { name: null, username: null, credentialDeleted: false },
    null,
  ],
];

describe('관리자 표시값 스냅샷 백필 (real DB)', () => {
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
    expect(statements).toHaveLength(4);
    for (const stmt of statements) await prisma.$executeRawUnsafe(stmt);
  }

  async function labeledAccount(
    accountType: 'SELLER' | 'ADMIN',
    spec: LabelCase[1],
  ): Promise<bigint> {
    const account = await createAccount(prisma, {
      account_type: accountType,
      name: spec.name,
    });
    if (spec.username !== null) {
      const credential = await createAccountCredential(prisma, {
        account_id: account.id,
        username: spec.username,
      });
      if (spec.credentialDeleted) {
        await prisma.accountCredential.update({
          where: { id: credential.id },
          data: { deleted_at: new Date() },
        });
      }
    }
    return account.id;
  }

  it.each(LABEL_CASES)(
    '매장 판매자 라벨: %s',
    async (_case, spec, expected) => {
      const seller = await labeledAccount('SELLER', spec);
      const store = await createStore(prisma, { seller_account_id: seller });

      await runBackfill();

      const row = await prisma.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      expect(row.seller_label_snapshot).toBe(expected);
    },
  );

  it.each(LABEL_CASES)(
    '신고 처리자 라벨: %s',
    async (_case, spec, expected) => {
      const resolver = await labeledAccount('ADMIN', spec);
      const report = await createReviewReport(prisma, { status: 'RESOLVED' });
      await prisma.reviewReport.update({
        where: { id: report.id },
        data: { resolved_by_account_id: resolver },
      });

      await runBackfill();

      const row = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: report.id },
      });
      expect(row.resolved_by_label_snapshot).toBe(expected);
    },
  );

  it.each(LABEL_CASES)(
    'SQL 규칙이 앱 헬퍼와 같다: %s',
    (_case, spec, expected) => {
      const username =
        spec.username !== null && !spec.credentialDeleted
          ? spec.username
          : null;
      expect(formatAccountLabel(spec.name, username)).toBe(expected);
    },
  );

  it('처리자가 없는 신고(미처리·작성자 삭제로 종결)는 라벨이 null로 남는다', async () => {
    const pending = await createReviewReport(prisma);
    const byAuthor = await createReviewReport(prisma, { status: 'RESOLVED' });

    await runBackfill();

    const rows = await prisma.reviewReport.findMany({
      where: { id: { in: [pending.id, byAuthor.id] } },
    });
    expect(rows.map((r) => r.resolved_by_label_snapshot)).toEqual([null, null]);
  });

  it.each<[string, 'active' | 'withdrawn' | 'no-profile', string | null]>([
    ['활동 중인 신고자는 현재 닉네임', 'active', '신고자닉'],
    ['이미 탈퇴한 신고자는 복원할 수 없어 null', 'withdrawn', null],
    ['프로필이 없는 신고자는 null', 'no-profile', null],
  ])('%s', async (_case, state, expected) => {
    const reporter = await createAccount(prisma, { account_type: 'USER' });
    if (state !== 'no-profile') {
      await createUserProfile(prisma, {
        account_id: reporter.id,
        nickname: '신고자닉',
      });
    }
    if (state === 'withdrawn') {
      // 탈퇴 처리와 같은 모양 — 닉네임을 deleted_<id>로 덮고 프로필·계정을 soft-delete
      await prisma.userProfile.update({
        where: { account_id: reporter.id },
        data: { nickname: `deleted_${reporter.id}`, deleted_at: new Date() },
      });
      await prisma.account.update({
        where: { id: reporter.id },
        data: { deleted_at: new Date() },
      });
    }
    const report = await createReviewReport(prisma, {
      reporter_account_id: reporter.id,
    });

    await runBackfill();

    const row = await prisma.reviewReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(row.reporter_nickname_snapshot).toBe(expected);
  });

  it('리뷰 매장명은 주문 품목의 주문 시점 매장명으로 채운다(현재 매장명이 아니다)', async () => {
    const item = await createOrderItem(prisma, {
      store_name_snapshot: '주문 시점 매장',
    });
    await prisma.store.update({
      where: { id: item.store_id },
      data: { store_name: '바뀐 매장' },
    });
    // 백필 대상 재현: 스냅샷이 비어 있는(=마이그레이션 전) 리뷰
    const review = await createReview(prisma, {
      order_item_id: item.id,
      store_name_snapshot: '',
    });

    await runBackfill();

    const row = await prisma.review.findUniqueOrThrow({
      where: { id: review.id },
    });
    expect(row.store_name_snapshot).toBe('주문 시점 매장');
  });
});
