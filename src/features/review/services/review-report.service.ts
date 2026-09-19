import { Injectable } from '@nestjs/common';

import { DomainException, type ErrorCode } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import { AccountUserRepository, UserBaseService } from '@/features/auth';
import {
  MAX_REVIEW_REPORT_DETAIL_LENGTH,
  MAX_REVIEW_REPORT_SNAPSHOT_LENGTH,
} from '@/features/review/constants/review.constants';
import type { ReportReviewCommentInput } from '@/features/review/dto/inputs/report-review-comment.input';
import type { ReportReviewInput } from '@/features/review/dto/inputs/report-review.input';
import {
  ReviewReportRepository,
  type ReportTarget,
} from '@/features/review/repositories/review-report.repository';
import type { ReviewReportResult } from '@/features/review/types/review-engagement-output.type';
import type { ReviewReport } from '@/generated/prisma/client';

/** 처리(삭제/기각)는 관리자 API가 한다. 대상 확인·본인 판정·멱등·생성은 repository가 대상·신고자를 잠근 한 트랜잭션에서 처리한다. */
@Injectable()
export class UserReportService extends UserBaseService {
  constructor(
    accounts: AccountUserRepository,
    private readonly reports: ReviewReportRepository,
  ) {
    super(accounts);
  }

  async reportReview(
    accountId: bigint,
    input: ReportReviewInput,
  ): Promise<ReviewReportResult> {
    await this.requireActiveUser(accountId);
    return this.submit(
      accountId,
      { kind: 'review', id: parseId(input.reviewId) },
      input,
      'REVIEW_NOT_FOUND',
    );
  }

  async reportReviewComment(
    accountId: bigint,
    input: ReportReviewCommentInput,
  ): Promise<ReviewReportResult> {
    await this.requireActiveUser(accountId);
    return this.submit(
      accountId,
      { kind: 'review_comment', id: parseId(input.commentId) },
      input,
      'REVIEW_COMMENT_NOT_FOUND',
    );
  }

  private async submit(
    accountId: bigint,
    target: ReportTarget,
    input: { reason: ReviewReport['reason']; detail?: string | null },
    notFoundCode: ErrorCode,
  ): Promise<ReviewReportResult> {
    const result = await this.reports.submitReport({
      reporterAccountId: accountId,
      target,
      reason: input.reason,
      detail: cleanNullableText(input.detail, MAX_REVIEW_REPORT_DETAIL_LENGTH),
      snapshotLength: MAX_REVIEW_REPORT_SNAPSHOT_LENGTH,
    });
    switch (result.outcome) {
      case 'created':
      case 'already-pending':
        return this.toResult(
          result.report,
          result.outcome === 'already-pending',
        );
      case 'not-found':
        throw new DomainException(notFoundCode);
      case 'own-content':
        throw new DomainException('CANNOT_REPORT_OWN_CONTENT');
    }
  }

  private toResult(
    row: ReviewReport,
    alreadyReported: boolean,
  ): ReviewReportResult {
    return {
      reportId: row.id.toString(),
      status: row.status,
      alreadyReported,
      createdAt: row.created_at,
    };
  }
}
