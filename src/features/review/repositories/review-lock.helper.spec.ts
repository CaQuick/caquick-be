import {
  lockActiveReviewRow,
  lockParentReviewOfComment,
  resolvePendingReports,
} from './review-lock.helper';

import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createReview,
  createReviewReport,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('review-lock.helper (real DB)', () => {
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

  describe('lockActiveReviewRow', () => {
    it('활성 행은 true, soft-delete·없는 행은 false', async () => {
      const review = await createReview(prisma);
      const deleted = await createReview(prisma);
      await prisma.review.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });
      await prisma.$transaction(async (tx) => {
        expect(await lockActiveReviewRow(tx, 'review', review.id)).toBe(true);
        expect(await lockActiveReviewRow(tx, 'review', deleted.id)).toBe(false);
        expect(await lockActiveReviewRow(tx, 'review', 999_999n)).toBe(false);
      });
    });

    it('댓글·신고 테이블도 같은 규칙', async () => {
      const review = await createReview(prisma);
      const comment = await prisma.reviewComment.create({
        data: {
          review_id: review.id,
          account_id: review.account_id,
          content: 'c',
        },
      });
      const report = await createReviewReport(prisma, { review_id: review.id });
      await prisma.$transaction(async (tx) => {
        expect(
          await lockActiveReviewRow(tx, 'review_comment', comment.id),
        ).toBe(true);
        expect(await lockActiveReviewRow(tx, 'review_report', report.id)).toBe(
          true,
        );
      });
    });
  });

  describe('lockParentReviewOfComment', () => {
    it('없는 댓글이어도 예외 없이 지나간다', async () => {
      await expect(
        prisma.$transaction((tx) => lockParentReviewOfComment(tx, 999_999n)),
      ).resolves.toBeUndefined();
    });
  });

  describe('resolvePendingReports', () => {
    it('PENDING만 종결하고 처리자·메모·시각을 기록한다', async () => {
      const review = await createReview(prisma);
      const admin = await createAccount(prisma, { account_type: 'ADMIN' });
      const pending = await createReviewReport(prisma, {
        review_id: review.id,
      });
      const done = await createReviewReport(prisma, {
        review_id: review.id,
        status: 'RESOLVED',
      });
      await prisma.reviewReport.update({
        where: { id: done.id },
        data: { resolution_note: 'earlier' },
      });
      const other = await createReviewReport(prisma);
      const now = new Date('2026-09-19T00:00:00.000Z');

      const count = await prisma.$transaction((tx) =>
        resolvePendingReports(tx, {
          where: { review_id: review.id },
          now,
          resolvedByAccountId: admin.id,
          note: 'closed',
        }),
      );

      expect(count).toBe(1);
      const after = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: pending.id },
      });
      expect(after).toMatchObject({
        status: 'RESOLVED',
        resolved_by_account_id: admin.id,
        resolved_at: now,
        resolution_note: 'closed',
      });
      expect(
        (
          await prisma.reviewReport.findUniqueOrThrow({
            where: { id: done.id },
          })
        ).resolution_note,
      ).toBe('earlier');
      expect(
        (
          await prisma.reviewReport.findUniqueOrThrow({
            where: { id: other.id },
          })
        ).status,
      ).toBe('PENDING');
    });

    it('처리자 없이(작성자 삭제) 종결하면 resolved_by_account_id는 null', async () => {
      const review = await createReview(prisma);
      const report = await createReviewReport(prisma, { review_id: review.id });
      await prisma.$transaction((tx) =>
        resolvePendingReports(tx, {
          where: { review_id: review.id },
          now: new Date(),
          resolvedByAccountId: null,
          note: 'author',
        }),
      );
      const after = await prisma.reviewReport.findUniqueOrThrow({
        where: { id: report.id },
      });
      expect(after.status).toBe('RESOLVED');
      expect(after.resolved_by_account_id).toBeNull();
    });
  });
});
