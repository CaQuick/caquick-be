import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ReviewReport } from '@prisma/client';

import { parseId } from '@/common/utils/id-parser';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import { USER_REVIEW_ERRORS } from '@/features/user/constants/user-review-error-messages';
import {
  MAX_REVIEW_REPORT_DETAIL_LENGTH,
  MAX_REVIEW_REPORT_SNAPSHOT_LENGTH,
} from '@/features/user/constants/user.constants';
import type { ReportReviewCommentInput } from '@/features/user/dto/inputs/report-review-comment.input';
import type { ReportReviewInput } from '@/features/user/dto/inputs/report-review.input';
import {
  ReviewReportRepository,
  type ReportTargetRow,
} from '@/features/user/repositories/review-report.repository';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserBaseService } from '@/features/user/services/user-base.service';
import type { ReviewReportResult } from '@/features/user/types/user-review-output.type';

/**
 * 리뷰·댓글 신고 접수. 처리(삭제/기각)는 관리자 API가 한다.
 * 본인 작성물은 신고할 수 없고, 같은 대상의 미처리 신고는 새로 만들지 않는다(멱등).
 */
@Injectable()
export class UserReportService extends UserBaseService {
  constructor(
    repo: UserRepository,
    private readonly reports: ReviewReportRepository,
  ) {
    super(repo);
  }

  async reportReview(
    accountId: bigint,
    input: ReportReviewInput,
  ): Promise<ReviewReportResult> {
    await this.requireActiveUser(accountId);
    const reviewId = parseId(input.reviewId);
    const target = await this.reports.findReportableReview(reviewId);
    if (!target)
      throw new NotFoundException(USER_REVIEW_ERRORS.REVIEW_NOT_FOUND);
    return this.submit(accountId, target, { reviewId }, input);
  }

  async reportReviewComment(
    accountId: bigint,
    input: ReportReviewCommentInput,
  ): Promise<ReviewReportResult> {
    await this.requireActiveUser(accountId);
    const commentId = parseId(input.commentId);
    const target = await this.reports.findReportableComment(commentId);
    if (!target) {
      throw new NotFoundException(USER_REVIEW_ERRORS.COMMENT_NOT_FOUND);
    }
    return this.submit(
      accountId,
      target,
      { reviewCommentId: commentId },
      input,
    );
  }

  private async submit(
    accountId: bigint,
    target: ReportTargetRow,
    key: { reviewId?: bigint; reviewCommentId?: bigint },
    input: { reason: ReviewReport['reason']; detail?: string | null },
  ): Promise<ReviewReportResult> {
    if (target.account_id === accountId) {
      throw new BadRequestException(
        USER_REVIEW_ERRORS.CANNOT_REPORT_OWN_CONTENT,
      );
    }
    // 조회·생성은 repository가 신고자 행을 잠근 트랜잭션 안에서 한다(동시 요청 중복 방지)
    const { report, created } = await this.reports.findOrCreatePendingReport({
      reporterAccountId: accountId,
      reviewId: key.reviewId ?? null,
      reviewCommentId: key.reviewCommentId ?? null,
      reason: input.reason,
      detail: cleanNullableText(input.detail, MAX_REVIEW_REPORT_DETAIL_LENGTH),
      // 작성자가 삭제·재작성하면 같은 id가 새 내용으로 복원되므로 신고 시점 본문을 남긴다
      contentSnapshot:
        target.content?.slice(0, MAX_REVIEW_REPORT_SNAPSHOT_LENGTH) ?? null,
    });
    return this.toResult(report, !created);
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
