import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/prisma';

export interface RecentViewedProductRow {
  product_id: bigint;
  viewed_at: Date;
  product: {
    name: string;
    regular_price: number;
    sale_price: number | null;
    store: {
      store_name: string;
    };
    images: {
      image_url: string;
    }[];
  };
}

@Injectable()
export class RecentProductViewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findRecentByAccountPaginated(args: {
    accountId: bigint;
    offset: number;
    limit: number;
  }): Promise<{ items: RecentViewedProductRow[]; totalCount: number }> {
    const where = {
      account_id: args.accountId,
      product: {
        deleted_at: null,
        is_active: true,
        store: { deleted_at: null },
      },
    };

    const selectFields = {
      product_id: true as const,
      viewed_at: true as const,
      product: {
        select: {
          name: true as const,
          regular_price: true as const,
          sale_price: true as const,
          store: { select: { store_name: true as const } },
          images: {
            where: { deleted_at: null },
            orderBy: { sort_order: 'asc' as const },
            take: 1,
            select: { image_url: true as const },
          },
        },
      },
    };

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.recentProductView.findMany({
        where,
        orderBy: { viewed_at: 'desc' },
        skip: args.offset,
        take: args.limit,
        select: selectFields,
      }),
      this.prisma.recentProductView.count({ where }),
    ]);

    return { items, totalCount };
  }

  async upsertView(args: {
    accountId: bigint;
    productId: bigint;
    now: Date;
  }): Promise<void> {
    await this.prisma.recentProductView.upsert({
      where: {
        account_id_product_id: {
          account_id: args.accountId,
          product_id: args.productId,
        },
      },
      create: {
        account_id: args.accountId,
        product_id: args.productId,
        viewed_at: args.now,
      },
      update: {
        viewed_at: args.now,
        deleted_at: null,
      },
    });
  }

  async countByAccount(accountId: bigint): Promise<number> {
    return this.prisma.recentProductView.count({
      where: { account_id: accountId },
    });
  }

  async deleteOldestOverLimit(args: {
    accountId: bigint;
    maxCount: number;
    now: Date;
  }): Promise<void> {
    const oldest = await this.prisma.recentProductView.findMany({
      where: { account_id: args.accountId },
      orderBy: { viewed_at: 'desc' },
      skip: args.maxCount,
      select: { id: true },
    });

    if (oldest.length > 0) {
      await this.prisma.recentProductView.updateMany({
        where: { id: { in: oldest.map((o) => o.id) } },
        data: { deleted_at: args.now },
      });
    }
  }

  async softDeleteByProduct(args: {
    accountId: bigint;
    productId: bigint;
    now: Date;
  }): Promise<boolean> {
    const result = await this.prisma.recentProductView.updateMany({
      where: {
        account_id: args.accountId,
        product_id: args.productId,
        deleted_at: null,
      },
      data: { deleted_at: args.now },
    });
    return result.count > 0;
  }

  async softDeleteAllByAccount(args: {
    accountId: bigint;
    now: Date;
  }): Promise<number> {
    const result = await this.prisma.recentProductView.updateMany({
      where: {
        account_id: args.accountId,
        deleted_at: null,
      },
      data: { deleted_at: args.now },
    });
    return result.count;
  }

  async findRecentByAccount(
    accountId: bigint,
    limit: number,
  ): Promise<RecentViewedProductRow[]> {
    return this.prisma.recentProductView.findMany({
      where: {
        account_id: accountId,
        product: {
          deleted_at: null,
          is_active: true,
          store: { deleted_at: null },
        },
      },
      orderBy: { viewed_at: 'desc' },
      take: limit,
      select: {
        product_id: true,
        viewed_at: true,
        product: {
          select: {
            name: true,
            regular_price: true,
            sale_price: true,
            store: {
              select: { store_name: true },
            },
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
}
