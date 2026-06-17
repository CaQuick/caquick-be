import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/prisma';

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

  /** 1차 광역 지역 목록. hasChildren 판정을 위해 활성 2차를 1건만 동반 조회. */
  async findActiveGroups(): Promise<RegionGroupRow[]> {
    return this.prisma.region.findMany({
      where: { level: 1, is_active: true, deleted_at: null },
      orderBy: { sort_order: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        children: {
          where: { is_active: true, deleted_at: null },
          select: { id: true },
          take: 1,
        },
      },
    });
  }

  /** 특정 1차 지역에 속한 활성 2차 시군구 목록. */
  async findActiveChildren(parentId: bigint): Promise<RegionRow[]> {
    return this.prisma.region.findMany({
      where: {
        parent_id: parentId,
        level: 2,
        is_active: true,
        deleted_at: null,
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

  /** parentId 유효성 검증용. 활성 1차 지역 존재 여부. */
  async existsActiveGroup(id: bigint): Promise<boolean> {
    const found = await this.prisma.region.findFirst({
      where: { id, level: 1, is_active: true, deleted_at: null },
      select: { id: true },
    });
    return Boolean(found);
  }

  /** 지역명 부분일치 검색. 1·2차 모두 대상. 2차는 parent명을 동반 조회. */
  async searchActiveByName(
    keyword: string,
    limit: number,
  ): Promise<RegionSearchRow[]> {
    return this.prisma.region.findMany({
      where: {
        name: { contains: keyword },
        is_active: true,
        deleted_at: null,
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
