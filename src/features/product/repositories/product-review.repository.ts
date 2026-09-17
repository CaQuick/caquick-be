import { Injectable } from '@nestjs/common';

import type { ProductReviewRow } from '@/features/review';
import type { Prisma } from '@/generated/prisma/client';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

export interface ReviewAuthorRow {
  user_profile: {
    nickname: string;
    profile_image_url: string | null;
    deleted_at: Date | null;
  } | null;
}

export interface ReviewDetailProductRow {
  id: bigint;
  name: string;
  regular_price: number;
  sale_price: number | null;
  images: { image_url: string }[];
  store: {
    store_name: string;
    address_city: string | null;
    address_neighborhood: string | null;
    region: { name: string } | null;
  };
}

export interface ReviewDetailRow extends ProductReviewRow {
  product: ReviewDetailProductRow;
}

export interface ReviewCommentRow {
  id: bigint;
  content: string;
  created_at: Date;
  account_id: bigint;
  account: ReviewAuthorRow;
}

/** 목록·집계·쇼케이스는 review feature의 ReviewReadRepository가 담당한다. */
@Injectable()
export class ProductReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly publicReviewWhere: Prisma.ReviewWhereInput = {
    ...activeWhere,
    product: visibleWhere,
    store: visibleWhere,
  };

  async findReviewDetailById(
    reviewId: bigint,
  ): Promise<ReviewDetailRow | null> {
    return this.prisma.review.findFirst({
      where: { id: reviewId, ...this.publicReviewWhere },
      select: {
        id: true,
        rating: true,
        content: true,
        created_at: true,
        account: {
          // soft-delete extension은 nested relation에 deleted_at을 주입하지 않으므로
          // deleted_at을 함께 읽어 탈퇴 작성자는 매퍼에서 익명화한다
          select: {
            user_profile: {
              select: {
                nickname: true,
                profile_image_url: true,
                deleted_at: true,
              },
            },
          },
        },
        media: {
          where: activeWhere,
          orderBy: { sort_order: 'asc' },
          select: {
            media_type: true,
            media_url: true,
            thumbnail_url: true,
            sort_order: true,
          },
        },
        order_item: {
          select: {
            option_items: {
              where: activeWhere,
              orderBy: { id: 'asc' },
              select: {
                group_name_snapshot: true,
                option_title_snapshot: true,
              },
            },
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            regular_price: true,
            sale_price: true,
            images: {
              where: activeWhere,
              orderBy: { sort_order: 'asc' },
              take: 1,
              select: { image_url: true },
            },
            store: {
              select: {
                store_name: true,
                address_city: true,
                address_neighborhood: true,
                region: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  async existsPublicReview(reviewId: bigint): Promise<boolean> {
    const found = await this.prisma.review.findFirst({
      where: { id: reviewId, ...this.publicReviewWhere },
      select: { id: true },
    });
    return Boolean(found);
  }

  async listReviewComments(args: {
    reviewId: bigint;
    limit: number;
    cursor?: bigint;
  }): Promise<ReviewCommentRow[]> {
    return this.prisma.reviewComment.findMany({
      where: {
        review_id: args.reviewId,
        ...(args.cursor !== undefined ? { id: { gt: args.cursor } } : {}),
      },
      select: {
        id: true,
        content: true,
        created_at: true,
        account_id: true,
        account: {
          select: {
            user_profile: {
              select: {
                nickname: true,
                profile_image_url: true,
                deleted_at: true,
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
      take: args.limit + 1,
    });
  }

  async countReviewComments(reviewId: bigint): Promise<number> {
    return this.prisma.reviewComment.count({
      where: { review_id: reviewId },
    });
  }
}
