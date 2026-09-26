import { Inject, Injectable } from '@nestjs/common';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import type { AdminDeleteReviewCommentInput } from '@/features/review/dto/inputs/admin-delete-review-comment.input';
import type { AdminDeleteReviewInput } from '@/features/review/dto/inputs/admin-delete-review.input';
import type { AdminResolveReviewReportInput } from '@/features/review/dto/inputs/admin-resolve-review-report.input';
import type { AdminReviewCommentListInput } from '@/features/review/dto/inputs/admin-review-comment-list.input';
import type { AdminReviewListInput } from '@/features/review/dto/inputs/admin-review-list.input';
import type { AdminReviewReportListInput } from '@/features/review/dto/inputs/admin-review-report-list.input';
import { ReviewAdminRepository } from '@/features/review/repositories/review-admin.repository';
import {
  toAdminReviewCommentOutput,
  toAdminReviewOutput,
  toAdminReviewReportDetailOutput,
  toAdminReviewReportOutput,
} from '@/features/review/services/review-admin-mappers.helper';
import type {
  AdminReviewCommentOutput,
  AdminReviewOutput,
  AdminReviewReportDetailOutput,
  AdminReviewReportOutput,
} from '@/features/review/types/review-admin-output.type';

/** 작성자 본인 삭제와 달리 사유를 남기고 미처리 신고를 닫는다. 잠금·멱등·감사는 repository가 한 트랜잭션에서 처리한다. */
@Injectable()
export class AdminModerationService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    protected readonly repo: ReviewAdminRepository,
  ) {
    super(accounts, auditLogs);
  }

  async adminReviewReports(
    accountId: bigint,
    input?: AdminReviewReportListInput,
  ): Promise<CursorConnection<AdminReviewReportOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: parseOptionalId(input?.cursor),
    });
    // SDL 기본값이 PENDING이라 미지정은 PENDING, 명시적 null은 전체
    const filter = {
      status: input?.status === undefined ? ('PENDING' as const) : input.status,
      targetType: input?.targetType,
    };

    const [rows, totalCount] = await Promise.all([
      this.repo.listReviewReports({ ...filter, ...normalized }),
      this.repo.countReviewReports(filter),
    ]);
    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminReviewReportOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminReviewReport(
    accountId: bigint,
    reportId: bigint,
  ): Promise<AdminReviewReportDetailOutput> {
    await this.requireAdminContext(accountId);
    const row = await this.repo.findReviewReportDetailById(reportId);
    const detail = row ? toAdminReviewReportDetailOutput(row) : null;
    if (!detail) throw new DomainException('REVIEW_REPORT_NOT_FOUND');
    return detail;
  }

  async adminResolveReviewReport(
    accountId: bigint,
    input: AdminResolveReviewReportInput,
  ): Promise<AdminReviewReportOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const result = await this.repo.resolveReviewReport({
      reportId: parseId(input.reportId),
      action: input.action,
      note: cleanNullableText(input.note, MAX_REASON_LENGTH),
      actorAccountId: ctx.accountId,
    });
    if (result === 'not-found') {
      throw new DomainException('REVIEW_REPORT_NOT_FOUND');
    }
    if (result === 'already-resolved') {
      throw new DomainException('REVIEW_REPORT_ALREADY_RESOLVED');
    }
    return toAdminReviewReportOutput(result);
  }

  async adminReviews(
    accountId: bigint,
    input?: AdminReviewListInput,
  ): Promise<CursorConnection<AdminReviewOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: parseOptionalId(input?.cursor),
    });
    const filter = {
      keyword: input?.keyword?.trim() || undefined,
      storeId: parseOptionalId(input?.storeId) ?? undefined,
      accountId: parseOptionalId(input?.accountId) ?? undefined,
      includeDeleted: input?.includeDeleted ?? false,
    };

    const [rows, totalCount] = await Promise.all([
      this.repo.listReviews({ ...filter, ...normalized }),
      this.repo.countReviews(filter),
    ]);
    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminReviewOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminReviewComments(
    accountId: bigint,
    input?: AdminReviewCommentListInput,
  ): Promise<CursorConnection<AdminReviewCommentOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: parseOptionalId(input?.cursor),
    });
    const filter = {
      reviewId: parseOptionalId(input?.reviewId) ?? undefined,
      accountId: parseOptionalId(input?.accountId) ?? undefined,
      includeDeleted: input?.includeDeleted ?? false,
    };

    const [rows, totalCount] = await Promise.all([
      this.repo.listReviewComments({ ...filter, ...normalized }),
      this.repo.countReviewComments(filter),
    ]);
    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminReviewCommentOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminDeleteReview(
    accountId: bigint,
    input: AdminDeleteReviewInput,
  ): Promise<boolean> {
    const ctx = await this.requireAdminContext(accountId);
    const deleted = await this.repo.adminSoftDeleteReview({
      reviewId: parseId(input.reviewId),
      reason: cleanRequiredText(input.reason, MAX_REASON_LENGTH),
      actorAccountId: ctx.accountId,
    });
    if (!deleted) throw new DomainException('REVIEW_NOT_FOUND');
    return true;
  }

  async adminDeleteReviewComment(
    accountId: bigint,
    input: AdminDeleteReviewCommentInput,
  ): Promise<boolean> {
    const ctx = await this.requireAdminContext(accountId);
    const deleted = await this.repo.adminSoftDeleteReviewComment({
      commentId: parseId(input.commentId),
      reason: cleanRequiredText(input.reason, MAX_REASON_LENGTH),
      actorAccountId: ctx.accountId,
    });
    if (!deleted) throw new DomainException('REVIEW_COMMENT_NOT_FOUND');
    return true;
  }
}
