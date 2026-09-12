import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { ReportReviewCommentInput } from '@/features/user/dto/inputs/report-review-comment.input';
import { ReportReviewInput } from '@/features/user/dto/inputs/report-review.input';
import { UserReportService } from '@/features/user/services/user-report.service';
import type { ReviewReportResult } from '@/features/user/types/user-review-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserReportMutationResolver {
  constructor(private readonly reportService: UserReportService) {}

  @Mutation('reportReview')
  reportReview(
    @CurrentUser() user: JwtUser,
    @Args('input') input: ReportReviewInput,
  ): Promise<ReviewReportResult> {
    return this.reportService.reportReview(parseAccountId(user), input);
  }

  @Mutation('reportReviewComment')
  reportReviewComment(
    @CurrentUser() user: JwtUser,
    @Args('input') input: ReportReviewCommentInput,
  ): Promise<ReviewReportResult> {
    return this.reportService.reportReviewComment(parseAccountId(user), input);
  }
}
