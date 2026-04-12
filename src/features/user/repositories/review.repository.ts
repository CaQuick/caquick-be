import { Injectable } from '@nestjs/common';
import type { ReviewMediaType } from '@prisma/client';

import { PrismaService } from '@/prisma';

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
              where: { deleted_at: null },
              orderBy: { sort_order: 'asc' },
              take: 1,
              select: { image_url: true },
            },
          },
        },
      },
    });
  }

  async createReviewWithMedia(args: {
    orderItemId: bigint;
    accountId: bigint;
    storeId: bigint;
    productId: bigint;
    rating: number;
    content: string;
    media: {
      media_type: ReviewMediaType;
      media_url: string;
      thumbnail_url: string | null;
      sort_order: number;
    }[];
  }) {
    return this.prisma.$transaction(async (tx) => {
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

      if (args.media.length > 0) {
        await tx.reviewMedia.createMany({
          data: args.media.map((m) => ({
            review_id: review.id,
            media_type: m.media_type,
            media_url: m.media_url,
            thumbnail_url: m.thumbnail_url,
            sort_order: m.sort_order,
          })),
        });
      }

      return this.findReviewById(review.id, tx);
    });
  }

  private async findReviewById(
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
                  where: { deleted_at: null },
                  orderBy: { sort_order: 'asc' },
                  take: 1,
                  select: { image_url: true },
                },
              },
            },
          },
        },
        media: {
          where: { deleted_at: null },
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
                    where: { deleted_at: null },
                    orderBy: { sort_order: 'asc' },
                    take: 1,
                    select: { image_url: true },
                  },
                },
              },
            },
          },
          media: {
            where: { deleted_at: null },
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
    const result = await this.prisma.review.updateMany({
      where: {
        id: args.reviewId,
        account_id: args.accountId,
        deleted_at: null,
      },
      data: { deleted_at: args.now },
    });
    return result.count > 0;
  }
}
