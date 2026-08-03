import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import { USER_REVIEW_ERRORS } from '@/features/user/constants/user-review-error-messages';
import { MAX_REVIEW_COMMENT_LENGTH } from '@/features/user/constants/user.constants';
import type { WriteReviewCommentInput } from '@/features/user/dto/inputs/write-review-comment.input';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserBaseService } from '@/features/user/services/user-base.service';
import type { MyReviewComment } from '@/features/user/types/user-review-output.type';

@Injectable()
export class UserEngagementService extends UserBaseService {
  constructor(repo: UserRepository) {
    super(repo);
  }

  async likeReview(accountId: bigint, reviewId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const result = await this.repo.likeReview({
      accountId,
      reviewId,
    });

    if (result === 'not-found') {
      throw new NotFoundException('Review not found.');
    }
    if (result === 'self-like') {
      throw new BadRequestException('Cannot like your own review.');
    }

    return true;
  }

  /** 리뷰 좋아요 해제. 좋아요가 없어도 true(멱등). */
  async unlikeReview(accountId: bigint, reviewId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const result = await this.repo.unlikeReview({ accountId, reviewId });
    if (result === 'not-found') {
      throw new NotFoundException(USER_REVIEW_ERRORS.REVIEW_NOT_FOUND);
    }

    return true;
  }

  /** 리뷰 댓글 작성. 리뷰가 없으면 NOT_FOUND. */
  async writeReviewComment(
    accountId: bigint,
    input: WriteReviewCommentInput,
  ): Promise<MyReviewComment> {
    await this.requireActiveUser(accountId);

    const content = cleanRequiredText(input.content, MAX_REVIEW_COMMENT_LENGTH);
    const created = await this.repo.createReviewComment({
      accountId,
      reviewId: parseId(input.reviewId),
      content,
    });
    if (created === 'review-not-found') {
      throw new NotFoundException(USER_REVIEW_ERRORS.REVIEW_NOT_FOUND);
    }

    return {
      id: created.id.toString(),
      reviewId: created.review_id.toString(),
      content: created.content,
      createdAt: created.created_at,
    };
  }

  /** 내 리뷰 댓글 삭제(soft). 본인 댓글이 아니면 FORBIDDEN. */
  async deleteMyReviewComment(
    accountId: bigint,
    commentId: bigint,
  ): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const result = await this.repo.softDeleteMyReviewComment({
      accountId,
      commentId,
    });
    if (result === 'not-found') {
      throw new NotFoundException(USER_REVIEW_ERRORS.COMMENT_NOT_FOUND);
    }
    if (result === 'forbidden') {
      throw new ForbiddenException(USER_REVIEW_ERRORS.NOT_COMMENT_OWNER);
    }

    return true;
  }
}
