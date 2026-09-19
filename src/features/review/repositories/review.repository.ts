import { Injectable } from '@nestjs/common';

import { REVIEW_REPORT_CLOSED_BY_AUTHOR_NOTE } from '@/features/review/constants/review.constants';
import { resolvePendingReports } from '@/features/review/repositories/review-lock.helper';
import type { ReviewMediaType } from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

@Injectable()
export class ReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOrderItemForReview(args: {
    orderItemId: bigint;
    accountId: bigint;
  }) {
    return this.prisma.orderItem.findFirst({
      where: {
        id: args.orderItemId,
        order: { account_id: args.accountId },
      },
      include: {
        order: { select: { status: true, account_id: true } },
        review: { select: { id: true, deleted_at: true } },
        store: { select: { store_name: true } },
        product: {
          select: {
            id: true,
            name: true,
            images: {
              where: activeWhere,
              orderBy: { sort_order: 'asc' },
              take: 1,
              select: { image_url: true },
            },
          },
        },
      },
    });
  }

  async createOrRestoreReviewWithMedia(args: {
    orderItemId: bigint;
    accountId: bigint;
    storeId: bigint;
    productId: bigint;
    rating: number;
    content: string;
    existingDeletedReviewId?: bigint;
    media: {
      media_type: ReviewMediaType;
      media_url: string;
      thumbnail_url: string | null;
      sort_order: number;
    }[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      let reviewId: bigint;

      if (args.existingDeletedReviewId) {
        // 같은 id가 새 내용으로 복원되므로, 옛 내용을 겨냥한 미처리 신고가 남아 있으면 닫는다
        // (삭제 시점에 이미 닫혔어야 하지만 방어적으로 한 번 더)
        await resolvePendingReports(tx, {
          where: {
            OR: [
              { review_id: args.existingDeletedReviewId },
              { review_comment: { review_id: args.existingDeletedReviewId } },
            ],
          },
          now: new Date(),
          resolvedByAccountId: null,
          note: REVIEW_REPORT_CLOSED_BY_AUTHOR_NOTE,
        });
        const restored = await tx.review.update({
          where: { id: args.existingDeletedReviewId },
          data: {
            rating: args.rating,
            content: args.content,
            deleted_at: null,
          },
        });
        reviewId = restored.id;

        await tx.reviewMedia.updateMany({
          where: { review_id: reviewId },
          data: { deleted_at: new Date() },
        });
      } else {
        const review = await tx.review.create({
          data: {
            order_item_id: args.orderItemId,
            account_id: args.accountId,
            store_id: args.storeId,
            product_id: args.productId,
            rating: args.rating,
            content: args.content,
          },
        });
        reviewId = review.id;
      }

      if (args.media.length > 0) {
        await tx.reviewMedia.createMany({
          data: args.media.map((m) => ({
            review_id: reviewId,
            media_type: m.media_type,
            media_url: m.media_url,
            thumbnail_url: m.thumbnail_url,
            sort_order: m.sort_order,
          })),
        });
      }

      return this.findReviewById(reviewId, tx);
    });
  }

  async findReviewById(
    reviewId: bigint,
    tx?: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  ) {
    const prisma = tx ?? this.prisma;
    return prisma.review.findFirst({
      where: { id: reviewId },
      include: {
        order_item: {
          select: {
            id: true,
            product_name_snapshot: true,
            store: { select: { store_name: true } },
            product: {
              select: {
                id: true,
                images: {
                  where: activeWhere,
                  orderBy: { sort_order: 'asc' },
                  take: 1,
                  select: { image_url: true },
                },
              },
            },
          },
        },
        media: {
          where: activeWhere,
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async listMyReviews(args: {
    accountId: bigint;
    offset: number;
    limit: number;
  }) {
    const where = { account_id: args.accountId };

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: args.offset,
        take: args.limit,
        include: {
          order_item: {
            select: {
              id: true,
              product_name_snapshot: true,
              store: { select: { store_name: true } },
              product: {
                select: {
                  id: true,
                  images: {
                    where: activeWhere,
                    orderBy: { sort_order: 'asc' },
                    take: 1,
                    select: { image_url: true },
                  },
                },
              },
            },
          },
          media: {
            where: activeWhere,
            orderBy: { sort_order: 'asc' },
          },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return { items, totalCount };
  }

  async softDeleteReview(args: {
    reviewId: bigint;
    accountId: bigint;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.review.updateMany({
        where: {
          id: args.reviewId,
          account_id: args.accountId,
          ...activeWhere,
        },
        data: { deleted_at: args.now },
      });

      if (result.count > 0) {
        // 대상이 사라진 미처리 신고는 닫는다 — 같은 id가 재작성으로 복원될 때 새 내용에 붙지 않게
        await resolvePendingReports(tx, {
          where: {
            OR: [
              { review_id: args.reviewId },
              { review_comment: { review_id: args.reviewId } },
            ],
          },
          now: args.now,
          resolvedByAccountId: null,
          note: REVIEW_REPORT_CLOSED_BY_AUTHOR_NOTE,
        });
        await tx.reviewMedia.updateMany({
          where: {
            review_id: args.reviewId,
            ...activeWhere,
          },
          data: { deleted_at: args.now },
        });
        // 리뷰 재작성(createOrRestoreReviewWithMedia)이 같은 review id를 복원하므로
        // 댓글을 남겨두면 삭제 전 댓글이 새 리뷰에 되살아난다. 함께 정리한다.
        await tx.reviewComment.updateMany({
          where: {
            review_id: args.reviewId,
            ...activeWhere,
          },
          data: { deleted_at: args.now },
        });
      }

      return result.count > 0;
    });
  }
}
