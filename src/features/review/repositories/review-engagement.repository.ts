import { Injectable } from '@nestjs/common';

import { buildReviewLikedNotification } from '@/features/notification';
import { REVIEW_REPORT_CLOSED_BY_AUTHOR_NOTE } from '@/features/review/constants/review.constants';
import {
  lockParentReviewOfComment,
  resolvePendingReports,
} from '@/features/review/repositories/review-lock.helper';
import { Prisma } from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

/** 리뷰 좋아요·댓글 write. 잠금 순서(리뷰 → 댓글 → 신고)는 review 소유 repository들이 같은 규칙을 공유한다. */
@Injectable()
export class ReviewEngagementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countMyReviews(accountId: bigint): Promise<number> {
    return this.prisma.review.count({ where: { account_id: accountId } });
  }

  async likeReview(args: {
    accountId: bigint;
    reviewId: bigint;
  }): Promise<'liked' | 'already-liked' | 'not-found' | 'self-like'> {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.findFirst({
        where: { id: args.reviewId },
        select: {
          id: true,
          account_id: true,
          store_id: true,
          product_id: true,
        },
      });

      if (!review) return 'not-found';
      if (review.account_id === args.accountId) return 'self-like';

      const existing = await tx.reviewLike.findFirst({
        where: {
          review_id: review.id,
          account_id: args.accountId,
          // soft-delete 필터 우회: 해제(soft-delete)된 좋아요도 찾아 복원한다.
          // uk_review_like 유니크 제약 때문에 새로 create하면 충돌한다.
          deleted_at: undefined,
        },
        select: { id: true, deleted_at: true },
      });

      if (existing && existing.deleted_at === null) return 'already-liked';

      if (existing) {
        // 해제했던 좋아요 복원. 좋아요↔해제 반복으로 인한 알림 스팸을 막기 위해
        // 알림은 최초 좋아요(신규 생성)에만 발송한다.
        await tx.reviewLike.update({
          where: { id: existing.id },
          data: { deleted_at: null },
        });
        return 'liked';
      }

      await tx.reviewLike.create({
        data: { review_id: review.id, account_id: args.accountId },
      });

      // 알림 내용은 notification feature가 단일 소스 — 여기는 저장 위임만 한다(outbox 소비자 전환 전까지 직접 write)
      await tx.notification.create({
        data: {
          account_id: review.account_id,
          review_id: review.id,
          store_id: review.store_id,
          product_id: review.product_id,
          ...buildReviewLikedNotification(),
        },
      });

      return 'liked';
    });
  }

  async unlikeReview(args: {
    accountId: bigint;
    reviewId: bigint;
  }): Promise<'unliked' | 'not-found'> {
    const review = await this.prisma.review.findFirst({
      where: { id: args.reviewId },
      select: { id: true },
    });
    if (!review) return 'not-found';

    await this.prisma.reviewLike.updateMany({
      where: {
        review_id: args.reviewId,
        account_id: args.accountId,
        ...activeWhere,
      },
      data: { deleted_at: new Date() },
    });
    return 'unliked';
  }

  /**
   * 공개 조회(reviewComments)와 동일한 상품·매장 활성 가드 — 작성 직후 조회 불가능한 댓글이 생기지 않게.
   * 리뷰 row를 FOR SHARE로 잠가 삭제 트랜잭션(review UPDATE → 댓글 정리)과 직렬화한다 — 체크와 insert 사이에
   * 리뷰가 삭제되어 정리 대상에서 빠지는 댓글(리뷰 재작성 시 되살아나는 좀비 댓글)을 막는다.
   */
  async createReviewComment(args: {
    accountId: bigint;
    reviewId: bigint;
    content: string;
  }): Promise<
    | { id: bigint; review_id: bigint; content: string; created_at: Date }
    | 'review-not-found'
  > {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
        SELECT r.id
        FROM review r
        JOIN product p
          ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
        JOIN store s
          ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL
        WHERE r.id = ${args.reviewId} AND r.deleted_at IS NULL
        FOR SHARE OF r
      `);
      if (locked.length === 0) return 'review-not-found';

      return tx.reviewComment.create({
        data: {
          review_id: args.reviewId,
          account_id: args.accountId,
          content: args.content,
        },
        select: { id: true, review_id: true, content: true, created_at: true },
      });
    });
  }

  async softDeleteMyReviewComment(args: {
    accountId: bigint;
    commentId: bigint;
  }): Promise<'deleted' | 'not-found' | 'forbidden'> {
    const comment = await this.prisma.reviewComment.findFirst({
      // extension이 주입하지만 재삭제 방지 계약을 코드에서 바로 읽도록 명시한다
      where: { id: args.commentId, ...activeWhere },
      select: { id: true, account_id: true },
    });
    if (!comment) return 'not-found';
    if (comment.account_id !== args.accountId) return 'forbidden';

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await lockParentReviewOfComment(tx, args.commentId);
      const deleted = await tx.reviewComment.updateMany({
        where: { id: args.commentId, ...activeWhere },
        data: { deleted_at: now },
      });
      // 리뷰 잠금을 기다리는 사이 리뷰 삭제가 댓글까지 지웠으면 그쪽이 신고도 닫았다
      if (deleted.count === 0) return 'not-found';
      await resolvePendingReports(tx, {
        where: { review_comment_id: args.commentId },
        now,
        resolvedByAccountId: null,
        note: REVIEW_REPORT_CLOSED_BY_AUTHOR_NOTE,
      });
      return 'deleted';
    });
  }
}
