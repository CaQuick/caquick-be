import { Injectable } from '@nestjs/common';

import { PrismaService, visibleWhere } from '@/prisma';

export interface RegionRow {
  id: bigint;
  parent_id: bigint | null;
  level: number;
  name: string;
  slug: string;
}

export interface RegionGroupRow {
  id: bigint;
  name: string;
  slug: string;
  children: { id: bigint }[];
}

export interface RegionSearchRow {
  id: bigint;
  name: string;
  level: number;
  parent: { name: string } | null;
}

@Injectable()
export class RegionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveGroups(): Promise<RegionGroupRow[]> {
    return this.prisma.region.findMany({
      where: { level: 1, is_active: true },
      orderBy: { sort_order: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        children: {
          where: visibleWhere,
          select: { id: true },
          take: 1,
        },
      },
    });
  }

  async findActiveChildren(parentId: bigint): Promise<RegionRow[]> {
    return this.prisma.region.findMany({
      where: {
        parent_id: parentId,
        level: 2,
        is_active: true,
      },
      orderBy: { sort_order: 'asc' },
      select: {
        id: true,
        parent_id: true,
        level: true,
        name: true,
        slug: true,
      },
    });
  }

  async existsActiveGroup(id: bigint): Promise<boolean> {
    const found = await this.prisma.region.findFirst({
      where: { id, level: 1, is_active: true },
      select: { id: true },
    });
    return Boolean(found);
  }

  async searchActiveByName(
    keyword: string,
    limit: number,
  ): Promise<RegionSearchRow[]> {
    return this.prisma.region.findMany({
      where: {
        name: { contains: keyword },
        is_active: true,
      },
      orderBy: [{ level: 'asc' }, { sort_order: 'asc' }],
      take: limit,
      select: {
        id: true,
        name: true,
        level: true,
        parent: { select: { name: true } },
      },
    });
  }
}
