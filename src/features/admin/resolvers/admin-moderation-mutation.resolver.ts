import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminDeleteReviewCommentInput } from '@/features/admin/dto/inputs/admin-delete-review-comment.input';
import { AdminDeleteReviewInput } from '@/features/admin/dto/inputs/admin-delete-review.input';
import { AdminResolveReviewReportInput } from '@/features/admin/dto/inputs/admin-resolve-review-report.input';
import { AdminModerationService } from '@/features/admin/services/admin-moderation.service';
import type { AdminReviewReportOutput } from '@/features/admin/types/admin-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminModerationMutationResolver {
  constructor(private readonly moderationService: AdminModerationService) {}

  @Mutation('adminResolveReviewReport')
  adminResolveReviewReport(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminResolveReviewReportInput,
  ): Promise<AdminReviewReportOutput> {
    return this.moderationService.adminResolveReviewReport(
      parseAccountId(user),
      input,
    );
  }

  @Mutation('adminDeleteReview')
  adminDeleteReview(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminDeleteReviewInput,
  ): Promise<boolean> {
    return this.moderationService.adminDeleteReview(
      parseAccountId(user),
      input,
    );
  }

  @Mutation('adminDeleteReviewComment')
  adminDeleteReviewComment(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminDeleteReviewCommentInput,
  ): Promise<boolean> {
    return this.moderationService.adminDeleteReviewComment(
      parseAccountId(user),
      input,
    );
  }
}
