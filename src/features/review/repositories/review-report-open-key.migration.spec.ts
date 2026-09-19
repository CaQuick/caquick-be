import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createReview } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// D7-c 마이그레이션의 백필 SQL을 그대로 실행해, 기존 신고에 open_key가 규칙대로 채워지는지 본다.
// 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20260919160000_review_report_open_key/migration.sql',
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

describe('review_report.open_key 백필 (real DB)', () => {
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

  /**
   * 마이그레이션과 같은 순서로 재현한다: unique 인덱스가 없는 상태에서 백필하고, 끝난 뒤 인덱스를 만든다.
   * 인덱스 생성이 성공하는 것 자체가 "중복 정리가 됐다"는 증거다(테스트 DB에는 인덱스가 이미 있어 먼저 떼어낸다).
   */
  async function runBackfill(): Promise<void> {
    const statements = backfillStatements();
    expect(statements).toHaveLength(2);
    await prisma.$executeRawUnsafe(
      'DROP INDEX `uk_review_report_open` ON `review_report`',
    );
    for (const stmt of statements) await prisma.$executeRawUnsafe(stmt);
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX `uk_review_report_open` ON `review_report`(`reporter_account_id`, `open_key`)',
    );
  }

  /** 백필 대상 재현: open_key가 비어 있는(=마이그레이션 전) 신고. */
  async function seedReport(args: {
    reporterAccountId: bigint;
    reviewId?: bigint;
    reviewCommentId?: bigint;
    status?: 'PENDING' | 'RESOLVED';
    deletedAt?: Date | null;
  }) {
    return prisma.reviewReport.create({
      data: {
        reporter_account_id: args.reporterAccountId,
        review_id: args.reviewId ?? null,
        review_comment_id: args.reviewCommentId ?? null,
        reason: 'SPAM',
        status: args.status ?? 'PENDING',
        deleted_at: args.deletedAt ?? null,
        open_key: null,
      },
    });
  }

  it('PENDING 신고에만 대상 키를 채우고 종결·삭제된 신고는 NULL로 남긴다', async () => {
    const review = await createReview(prisma);
    const reporter = await createAccount(prisma, { account_type: 'USER' });
    const comment = await prisma.reviewComment.create({
      data: {
        review_id: review.id,
        account_id: reporter.id,
        content: '댓글',
      },
    });

    const pendingReview = await seedReport({
      reporterAccountId: reporter.id,
      reviewId: review.id,
    });
    const pendingComment = await seedReport({
      reporterAccountId: reporter.id,
      reviewCommentId: comment.id,
    });
    const resolved = await seedReport({
      reporterAccountId: reporter.id,
      reviewId: review.id,
      status: 'RESOLVED',
    });
    const deleted = await seedReport({
      reporterAccountId: reporter.id,
      reviewId: review.id,
      deletedAt: new Date(),
    });

    await runBackfill();

    const keyOf = async (id: bigint) =>
      (await prisma.reviewReport.findUniqueOrThrow({ where: { id } })).open_key;
    expect(await keyOf(pendingReview.id)).toBe(`r:${review.id}`);
    expect(await keyOf(pendingComment.id)).toBe(`c:${comment.id}`);
    expect(await keyOf(resolved.id)).toBeNull();
    expect(await keyOf(deleted.id)).toBeNull();
  });

  it('같은 신고자·대상의 PENDING이 여러 건이면 가장 오래된 1건만 키를 갖는다(unique 생성 가능)', async () => {
    const review = await createReview(prisma);
    const reporter = await createAccount(prisma, { account_type: 'USER' });
    const first = await seedReport({
      reporterAccountId: reporter.id,
      reviewId: review.id,
    });
    const second = await seedReport({
      reporterAccountId: reporter.id,
      reviewId: review.id,
    });

    await runBackfill();

    const rows = await prisma.reviewReport.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((row) => [row.id, row.open_key])).toEqual([
      [first.id, `r:${review.id}`],
      [second.id, null],
    ]);
  });

  it('반증: 다른 신고자의 같은 대상 PENDING은 둘 다 키를 갖는다(중복 정리 대상이 아니다)', async () => {
    const review = await createReview(prisma);
    const [a, b] = await Promise.all([
      createAccount(prisma, { account_type: 'USER' }),
      createAccount(prisma, { account_type: 'USER' }),
    ]);
    await seedReport({ reporterAccountId: a.id, reviewId: review.id });
    await seedReport({ reporterAccountId: b.id, reviewId: review.id });

    await runBackfill();

    const keys = (await prisma.reviewReport.findMany()).map((r) => r.open_key);
    expect(keys).toEqual([`r:${review.id}`, `r:${review.id}`]);
  });
});
