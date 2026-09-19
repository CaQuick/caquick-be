import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import { AccountUserRepository, UserBaseService } from '@/features/auth';
import { MAX_REVIEW_COMMENT_LENGTH } from '@/features/review/constants/review.constants';
import type { WriteReviewCommentInput } from '@/features/review/dto/inputs/write-review-comment.input';
import { ReviewEngagementRepository } from '@/features/review/repositories/review-engagement.repository';
import type { MyReviewComment } from '@/features/review/types/review-engagement-output.type';

@Injectable()
export class UserEngagementService extends UserBaseService {
  constructor(
    accounts: AccountUserRepository,
    private readonly engagement: ReviewEngagementRepository,
  ) {
    super(accounts);
  }

  async likeReview(accountId: bigint, reviewId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const result = await this.engagement.likeReview({
      accountId,
      reviewId,
    });

    if (result === 'not-found') {
      throw new DomainException('REVIEW_NOT_FOUND');
    }
    if (result === 'self-like') {
      throw new DomainException('CANNOT_LIKE_OWN_REVIEW');
    }

    return true;
  }

  async unlikeReview(accountId: bigint, reviewId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const result = await this.engagement.unlikeReview({ accountId, reviewId });
    if (result === 'not-found') {
      throw new DomainException('REVIEW_NOT_FOUND');
    }

    return true;
  }

  async writeReviewComment(
    accountId: bigint,
    input: WriteReviewCommentInput,
  ): Promise<MyReviewComment> {
    await this.requireActiveUser(accountId);

    const content = cleanRequiredText(input.content, MAX_REVIEW_COMMENT_LENGTH);
    const created = await this.engagement.createReviewComment({
      accountId,
      reviewId: parseId(input.reviewId),
      content,
    });
    if (created === 'review-not-found') {
      throw new DomainException('REVIEW_NOT_FOUND');
    }

    return {
      id: created.id.toString(),
      reviewId: created.review_id.toString(),
      content: created.content,
      createdAt: created.created_at,
    };
  }

  async deleteMyReviewComment(
    accountId: bigint,
    commentId: bigint,
  ): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const result = await this.engagement.softDeleteMyReviewComment({
      accountId,
      commentId,
    });
    if (result === 'not-found') {
      throw new DomainException('REVIEW_COMMENT_NOT_FOUND');
    }
    if (result === 'forbidden') {
      throw new DomainException('NOT_COMMENT_OWNER');
    }

    return true;
  }
}
