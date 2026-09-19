import { Injectable } from '@nestjs/common';

import { Prisma } from '@/generated/prisma/client';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

export interface WishlistItemRow {
  product_id: bigint;
  created_at: Date;
  product: {
    store_id: bigint;
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
  };
}

@Injectable()
export class WishlistRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** count와 list가 같은 가시성 기준(활성 찜 + 활성 상품 + 활성 매장)을 공유해 마이페이지 카운트 카드와 실제 목록 길이 불일치를 막는다. */
  private visibleWishlistWhere(accountId: bigint, storeId?: bigint) {
    return {
      account_id: accountId,
      ...activeWhere,
      product: {
        ...visibleWhere,
        // 매장별 보기 → 매장 선택 화면의 매장 필터
        ...(storeId !== undefined ? { store_id: storeId } : {}),
        store: visibleWhere,
      },
    } as const;
  }

  async countWishlistItems(accountId: bigint): Promise<number> {
    return this.prisma.wishlistItem.count({
      where: this.visibleWishlistWhere(accountId),
    });
  }

  async isProductWishlisted(args: {
    accountId: bigint;
    productId: bigint;
  }): Promise<boolean> {
    const found = await this.prisma.wishlistItem.findFirst({
      where: { account_id: args.accountId, product_id: args.productId },
      select: { id: true },
    });
    return Boolean(found);
  }

  /**
   * 복원(재찜) 시에만 created_at을 재찜 시점으로 갱신한다 — '찜 최신순' 정렬과 addedAt이 재찜을 반영하되,
   * 이미 active인 찜에 대한 중복 요청(더블 탭·재시도)은 created_at을 건드리지 않아 멱등 계약을 지킨다(매장 찜과 동일).
   */
  async upsertWishlistItem(args: {
    accountId: bigint;
    productId: bigint;
    now: Date;
  }): Promise<void> {
    const restored = await this.prisma.wishlistItem.updateMany({
      where: {
        account_id: args.accountId,
        product_id: args.productId,
        deleted_at: { not: null },
      },
      data: { deleted_at: null, created_at: args.now, updated_at: args.now },
    });
    if (restored.count > 0) return;

    try {
      await this.prisma.wishlistItem.create({
        data: { account_id: args.accountId, product_id: args.productId },
      });
    } catch (error) {
      // active 찜이 이미 존재(unique 충돌) — 멱등이므로 무시
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }
  }

  async softDeleteWishlistItem(args: {
    accountId: bigint;
    productId: bigint;
    now: Date;
  }): Promise<void> {
    await this.prisma.wishlistItem.updateMany({
      where: {
        account_id: args.accountId,
        product_id: args.productId,
        ...activeWhere,
      },
      data: { deleted_at: args.now },
    });
  }

  /** 가시성 조건을 myWishlist/wishlistCount와 공유해 카드의 isWishlisted가 실제 찜 목록/카운트와 일관되게 한다. */
  async findWishlistedProductIds(args: {
    accountId: bigint;
    productIds: bigint[];
  }): Promise<Set<string>> {
    if (args.productIds.length === 0) return new Set();
    const rows = await this.prisma.wishlistItem.findMany({
      where: {
        ...this.visibleWishlistWhere(args.accountId),
        product_id: { in: args.productIds },
      },
      select: { product_id: true },
    });
    return new Set(rows.map((r) => r.product_id.toString()));
  }

  async aggregateProductWishlistCounts(
    productIds: bigint[],
  ): Promise<Map<bigint, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.wishlistItem.groupBy({
      by: ['product_id'],
      where: { product_id: { in: productIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.product_id, r._count._all]));
  }

  async findWishlistItems(args: {
    accountId: bigint;
    offset: number;
    limit: number;
    storeId?: bigint;
  }): Promise<{ items: WishlistItemRow[]; totalCount: number }> {
    const where = this.visibleWishlistWhere(args.accountId, args.storeId);

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.wishlistItem.findMany({
        where,
        // 같은 밀리초 생성 시 페이지 경계 흔들림 방지를 위해 product_id를 보조 정렬키로 둔다.
        orderBy: [{ created_at: 'desc' }, { product_id: 'desc' }],
        skip: args.offset,
        take: args.limit,
        select: {
          product_id: true,
          created_at: true,
          product: {
            select: {
              store_id: true,
              name: true,
              regular_price: true,
              sale_price: true,
              store: {
                select: {
                  store_name: true,
                  address_city: true,
                  address_neighborhood: true,
                  region: { select: { name: true } },
                },
              },
              images: {
                where: activeWhere,
                orderBy: { sort_order: 'asc' },
                take: 1,
                select: { image_url: true },
              },
            },
          },
        },
      }),
      this.prisma.wishlistItem.count({ where }),
    ]);

    return { items: rows, totalCount };
  }

  /**
   * WishlistItem에는 store_id가 없어(product 경유) Prisma groupBy로 매장 단위 집계가 불가능하다 → 최소 필드만
   * 가져와 service에서 그룹핑한다(찜은 사용자당 소규모 전제). 가시성은 findWishlistItems와 동일해야 totalCount 합이 일치한다.
   */
  async findVisibleWishlistItemsForGrouping(accountId: bigint): Promise<
    {
      created_at: Date;
      product: {
        store: {
          id: bigint;
          store_name: string;
          profile_image_url: string | null;
        };
      };
    }[]
  > {
    return this.prisma.wishlistItem.findMany({
      where: this.visibleWishlistWhere(accountId),
      select: {
        created_at: true,
        product: {
          select: {
            store: {
              select: {
                id: true,
                store_name: true,
                profile_image_url: true,
              },
            },
          },
        },
      },
    });
  }
}
