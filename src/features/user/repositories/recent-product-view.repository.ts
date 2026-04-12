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

  async findRecentByAccount(
    accountId: bigint,
    limit: number,
  ): Promise<RecentViewedProductRow[]> {
    return this.prisma.recentProductView.findMany({
      where: { account_id: accountId },
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
