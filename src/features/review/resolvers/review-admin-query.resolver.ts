import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { AdminReviewCommentListInput } from '@/features/review/dto/inputs/admin-review-comment-list.input';
import { AdminReviewListInput } from '@/features/review/dto/inputs/admin-review-list.input';
import { AdminReviewReportListInput } from '@/features/review/dto/inputs/admin-review-report-list.input';
import { AdminModerationService } from '@/features/review/services/review-admin.service';
import type {
  AdminReviewCommentOutput,
  AdminReviewOutput,
  AdminReviewReportDetailOutput,
  AdminReviewReportOutput,
} from '@/features/review/types/review-admin-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminModerationQueryResolver {
  constructor(private readonly moderationService: AdminModerationService) {}

  @Query('adminReviewReports')
  adminReviewReports(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminReviewReportListInput,
  ): Promise<CursorConnection<AdminReviewReportOutput>> {
    return this.moderationService.adminReviewReports(
      parseAccountId(user),
      input,
    );
  }

  @Query('adminReviewReport')
  adminReviewReport(
    @CurrentUser() user: JwtUser,
    @Args('reportId') reportId: string,
  ): Promise<AdminReviewReportDetailOutput> {
    return this.moderationService.adminReviewReport(
      parseAccountId(user),
      parseId(reportId),
    );
  }

  @Query('adminReviews')
  adminReviews(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminReviewListInput,
  ): Promise<CursorConnection<AdminReviewOutput>> {
    return this.moderationService.adminReviews(parseAccountId(user), input);
  }

  @Query('adminReviewComments')
  adminReviewComments(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminReviewCommentListInput,
  ): Promise<CursorConnection<AdminReviewCommentOutput>> {
    return this.moderationService.adminReviewComments(
      parseAccountId(user),
      input,
    );
  }
}
