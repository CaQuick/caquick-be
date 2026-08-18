import { Injectable } from '@nestjs/common';
import { Prisma, type ReviewMediaType } from '@prisma/client';

import { PrismaService } from '@/prisma';

export interface ProductReviewMediaRow {
  media_type: ReviewMediaType;
  media_url: string;
  thumbnail_url: string | null;
  sort_order: number;
}

/** 리뷰 작성자 프로필 row(탈퇴 여부 포함, 매퍼에서 익명화). */
export interface ReviewAuthorRow {
  user_profile: {
    nickname: string;
    profile_image_url: string | null;
    deleted_at: Date | null;
  } | null;
}

/** 상품 공개 리뷰 조회 결과 row. productReviews 매퍼 입력. */
export interface ProductReviewRow {
  id: bigint;
  rating: Prisma.Decimal;
  content: string | null;
  created_at: Date;
  account: ReviewAuthorRow;
  media: ProductReviewMediaRow[];
  order_item: {
    option_items: {
      group_name_snapshot: string;
      option_title_snapshot: string;
    }[];
  };
}

/** 리뷰 상세 상단 판매 케이크 정보 row. */
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

/** 리뷰 댓글 row. */
export interface ReviewCommentRow {
  id: bigint;
  content: string;
  created_at: Date;
  account_id: bigint;
  account: ReviewAuthorRow;
}

/**
 * 상품 공개 리뷰 조회 전용 repository.
 *
 * store feature의 StoreReviewRepository(매장 단위)와 대칭 구조.
 * 상품 상세 후기 탭(목록/사진후기/후기 상세/댓글) 유스케이스를 담당한다.
 */
@Injectable()
export class ProductReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 공개 리뷰 공통 가드: 리뷰·상품·매장 모두 활성. */
  private publicReviewWhere(photoOnly: boolean): Prisma.ReviewWhereInput {
    return {
      deleted_at: null,
      product: { is_active: true, deleted_at: null },
      store: { is_active: true, deleted_at: null },
      ...(photoOnly ? { media: { some: { deleted_at: null } } } : {}),
    };
  }

  /** 상품 리뷰 id 페이지(최신순, 커서 id desc). */
  async listProductReviewIdsLatest(args: {
    productId: bigint;
    photoOnly: boolean;
    limit: number;
    cursor?: bigint;
  }): Promise<bigint[]> {
    const rows = await this.prisma.review.findMany({
      where: {
        product_id: args.productId,
        ...this.publicReviewWhere(args.photoOnly),
        // 0n도 유효 인자(parseId("0")=0n). truthiness는 0n을 falsy로 떨궈
        // zero cursor가 페이지를 리셋하므로 undefined로만 분기한다.
        ...(args.cursor !== undefined ? { id: { lt: args.cursor } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
    return rows.map((row) => row.id);
  }

  /**
   * 상품 리뷰 id 페이지(좋아요순 desc, 동률이면 id desc).
   *
   * soft-delete된 좋아요를 제외한 집계 기준 정렬이 Prisma orderBy(_count)로는
   * 불가능하므로 raw 키셋 페이지네이션으로 조회한다. 커서는 이전 페이지 경계의
   * (likeCount, id) 값을 그대로 받아 이어간다 — 경계 리뷰의 좋아요 수가 요청
   * 사이에 변해도 페이지가 중복/누락되지 않는다.
   */
  async listProductReviewIdsByLikes(args: {
    productId: bigint;
    photoOnly: boolean;
    limit: number;
    cursor?: { likeCount: number; id: bigint };
  }): Promise<{ id: bigint; likeCount: number }[]> {
    const photoFilter = args.photoOnly
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM review_media m
          WHERE m.review_id = r.id AND m.deleted_at IS NULL
        )`
      : Prisma.empty;
    const cursorHaving =
      args.cursor !== undefined
        ? Prisma.sql`HAVING COUNT(l.id) < ${args.cursor.likeCount}
          OR (COUNT(l.id) = ${args.cursor.likeCount} AND r.id < ${args.cursor.id})`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      { id: bigint; like_count: bigint }[]
    >(Prisma.sql`
      SELECT r.id AS id, COUNT(l.id) AS like_count
      FROM review r
      JOIN product p
        ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
      JOIN store s
        ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL
      LEFT JOIN review_like l
        ON l.review_id = r.id AND l.deleted_at IS NULL
      WHERE r.product_id = ${args.productId} AND r.deleted_at IS NULL
      ${photoFilter}
      GROUP BY r.id
      ${cursorHaving}
      ORDER BY like_count DESC, r.id DESC
      LIMIT ${args.limit + 1}
    `);
    return rows.map((row) => ({
      id: row.id,
      likeCount: Number(row.like_count),
    }));
  }

  /**
   * 홈 제작 후기 쇼케이스 후보 id(전체기간 좋아요순 desc, 동률이면 id desc).
   *
   * Before(주문 커스텀 자유편집 크롭)/After(리뷰 이미지)가 모두 있는 리뷰만
   * 후보로 삼는다 — 대비 연출이 섹션의 본질이라 한쪽 없는 카드는 제외(정책 확정).
   * soft-delete 좋아요 제외 집계 정렬이라 raw SQL(리뷰 목록 좋아요순과 동일 패턴).
   */
  async listShowcaseReviewIdsByLikes(
    limit: number,
  ): Promise<{ id: bigint; likeCount: number }[]> {
    const rows = await this.prisma.$queryRaw<
      { id: bigint; like_count: bigint }[]
    >(Prisma.sql`
      SELECT r.id AS id, COUNT(l.id) AS like_count
      FROM review r
      JOIN product p
        ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
      JOIN store s
        ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL
      LEFT JOIN review_like l
        ON l.review_id = r.id AND l.deleted_at IS NULL
      WHERE r.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM review_media m
          WHERE m.review_id = r.id
            AND m.deleted_at IS NULL
            AND m.media_type = 'IMAGE'
        )
        AND EXISTS (
          SELECT 1 FROM order_item_custom_free_edit fe
          WHERE fe.order_item_id = r.order_item_id AND fe.deleted_at IS NULL
        )
      GROUP BY r.id
      ORDER BY like_count DESC, r.id DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      id: row.id,
      likeCount: Number(row.like_count),
    }));
  }

  /** 쇼케이스 id 페이지의 본문 row 일괄 조회(정렬은 service에서 id 순서로 복원). */
  async findShowcaseReviewRowsByIds(reviewIds: bigint[]): Promise<
    {
      id: bigint;
      content: string | null;
      account: {
        user_profile: { nickname: string; deleted_at: Date | null } | null;
      };
      media: { media_url: string }[];
      order_item: {
        free_edits: { crop_image_url: string }[];
      };
    }[]
  > {
    if (reviewIds.length === 0) return [];
    return this.prisma.review.findMany({
      where: { id: { in: reviewIds }, deleted_at: null },
      select: {
        id: true,
        content: true,
        account: {
          // soft-delete extension은 nested relation에 deleted_at을 주입하지 않으므로
          // deleted_at을 함께 읽어 탈퇴 작성자 닉네임은 매퍼에서 익명화한다
          select: {
            user_profile: { select: { nickname: true, deleted_at: true } },
          },
        },
        media: {
          where: { deleted_at: null, media_type: 'IMAGE' },
          orderBy: { sort_order: 'asc' },
          take: 1,
          select: { media_url: true },
        },
        order_item: {
          select: {
            free_edits: {
              where: { deleted_at: null },
              orderBy: { sort_order: 'asc' },
              take: 1,
              select: { crop_image_url: true },
            },
          },
        },
      },
    });
  }

  /** 상품 활성 리뷰 수(photoOnly=true면 사진 리뷰 수). */
  async countProductReviews(args: {
    productId: bigint;
    photoOnly: boolean;
  }): Promise<number> {
    return this.prisma.review.count({
      where: {
        product_id: args.productId,
        ...this.publicReviewWhere(args.photoOnly),
      },
    });
  }

  /** id 페이지의 리뷰 본문 row 일괄 조회(정렬은 service에서 id 순서로 복원). */
  async findProductReviewRowsByIds(
    reviewIds: bigint[],
  ): Promise<ProductReviewRow[]> {
    if (reviewIds.length === 0) return [];
    return this.prisma.review.findMany({
      where: { id: { in: reviewIds }, deleted_at: null },
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
          where: { deleted_at: null },
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
              where: { deleted_at: null },
              orderBy: { id: 'asc' },
              select: {
                group_name_snapshot: true,
                option_title_snapshot: true,
              },
            },
          },
        },
      },
    });
  }

  /** 리뷰 상세(본문 + 판매 케이크 정보). 리뷰·상품·매장 활성 가드. */
  async findReviewDetailById(
    reviewId: bigint,
  ): Promise<ReviewDetailRow | null> {
    return this.prisma.review.findFirst({
      where: { id: reviewId, ...this.publicReviewWhere(false) },
      select: {
        id: true,
        rating: true,
        content: true,
        created_at: true,
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
        media: {
          where: { deleted_at: null },
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
              where: { deleted_at: null },
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
              where: { deleted_at: null },
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

  /** 공개 리뷰 존재 여부(댓글 목록 진입 가드). */
  async existsPublicReview(reviewId: bigint): Promise<boolean> {
    const found = await this.prisma.review.findFirst({
      where: { id: reviewId, ...this.publicReviewWhere(false) },
      select: { id: true },
    });
    return Boolean(found);
  }

  /** 리뷰별 좋아요 수. */
  async aggregateLikeCounts(reviewIds: bigint[]): Promise<Map<bigint, number>> {
    if (reviewIds.length === 0) return new Map();
    const rows = await this.prisma.reviewLike.groupBy({
      by: ['review_id'],
      where: { review_id: { in: reviewIds }, deleted_at: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.review_id, r._count._all]));
  }

  /** 로그인 사용자가 좋아요한 review_id 집합(string). */
  async findLikedReviewIds(args: {
    reviewIds: bigint[];
    accountId: bigint;
  }): Promise<Set<string>> {
    if (args.reviewIds.length === 0) return new Set();
    const rows = await this.prisma.reviewLike.findMany({
      where: {
        review_id: { in: args.reviewIds },
        account_id: args.accountId,
        deleted_at: null,
      },
      select: { review_id: true },
    });
    return new Set(rows.map((r) => r.review_id.toString()));
  }

  /** 리뷰별 댓글 수. */
  async aggregateCommentCounts(
    reviewIds: bigint[],
  ): Promise<Map<bigint, number>> {
    if (reviewIds.length === 0) return new Map();
    const rows = await this.prisma.reviewComment.groupBy({
      by: ['review_id'],
      where: { review_id: { in: reviewIds }, deleted_at: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.review_id, r._count._all]));
  }

  /** 리뷰 댓글 목록(등록순, 커서 id asc). soft-delete 제외. */
  async listReviewComments(args: {
    reviewId: bigint;
    limit: number;
    cursor?: bigint;
  }): Promise<ReviewCommentRow[]> {
    return this.prisma.reviewComment.findMany({
      where: {
        review_id: args.reviewId,
        deleted_at: null,
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

  /** 리뷰 활성 댓글 수. */
  async countReviewComments(reviewId: bigint): Promise<number> {
    return this.prisma.reviewComment.count({
      where: { review_id: reviewId, deleted_at: null },
    });
  }
}
