import type {
  PrismaClient,
  ReviewReport,
  ReviewReportReason,
  ReviewReportStatus,
} from '@/generated/prisma/client';
import { createAccount } from '@/test/factories/account.factory';
import { createReview } from '@/test/factories/review.factory';

export interface ReviewReportOverrides {
  reporter_account_id?: bigint;
  review_id?: bigint | null;
  review_comment_id?: bigint | null;
  reason?: ReviewReportReason;
  detail?: string | null;
  status?: ReviewReportStatus;
  deleted_at?: Date | null;
}

/** 대상을 지정하지 않으면 새 리뷰를 만들어 신고한다. */
export async function createReviewReport(
  prisma: PrismaClient,
  overrides: ReviewReportOverrides = {},
): Promise<ReviewReport> {
  const reporterId =
    overrides.reporter_account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;
  const reviewId =
    overrides.review_id === undefined && overrides.review_comment_id == null
      ? (await createReview(prisma)).id
      : (overrides.review_id ?? null);

  return prisma.reviewReport.create({
    data: {
      reporter_account_id: reporterId,
      review_id: reviewId,
      review_comment_id: overrides.review_comment_id ?? null,
      reason: overrides.reason ?? 'SPAM',
      detail: overrides.detail ?? null,
      status: overrides.status ?? 'PENDING',
      deleted_at: overrides.deleted_at ?? null,
    },
  });
}
