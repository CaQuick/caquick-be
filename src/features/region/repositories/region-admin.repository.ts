import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditEntry,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { lockUsableRegion } from '@/features/region/repositories/region-lock.helper';
import { Prisma } from '@/generated/prisma/client';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

export type AdminRegionRow = Prisma.RegionGetPayload<{
  include: typeof regionInclude;
}>;
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

const regionInclude = {
  _count: {
    select: {
      stores: { where: activeWhere },
      children: { where: visibleWhere },
    },
  },
} as const;

/** 관리자 지역 마스터(1차·2차 계층) CRUD. 조작과 감사 기록을 한 트랜잭션으로 묶는다. */
@Injectable()
export class RegionAdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /**
   * 대상 행을 잠그고(FOR UPDATE) 미삭제인지 확인한다. 읽고-쓰는 조작(수정·토글·삭제)은 이 잠금
   * 뒤에 트랜잭션 안에서 다시 읽어야 한다 — 서비스가 미리 읽은 값은 다른 관리자의 커밋으로 낡을 수 있다.
   */
  private async lockActiveRegion(
    tx: Prisma.TransactionClient,
    id: bigint,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM region
      WHERE id = ${id} AND deleted_at IS NULL
      FOR UPDATE`;
    return rows.length > 0;
  }

  // ── 지역 마스터 ──

  async listRegions(args: {
    parentId?: bigint;
    includeInactive: boolean;
  }): Promise<AdminRegionRow[]> {
    return this.prisma.region.findMany({
      where: {
        ...(args.parentId !== undefined ? { parent_id: args.parentId } : {}),
        ...(args.includeInactive ? {} : { is_active: true }),
      },
      include: regionInclude,
      orderBy: [{ level: 'asc' }, { sort_order: 'asc' }, { id: 'asc' }],
    });
  }

  async findRegionById(regionId: bigint): Promise<AdminRegionRow | null> {
    return this.prisma.region.findFirst({
      where: { id: regionId },
      include: regionInclude,
    });
  }

  async isActiveRegionGroup(regionId: bigint): Promise<boolean> {
    return (
      (await this.prisma.region.findFirst({
        where: { id: regionId, level: 1, is_active: true },
        select: { id: true },
      })) !== null
    );
  }

  async existsActiveRegionSlug(slug: string): Promise<boolean> {
    return (
      (await this.prisma.region.findFirst({
        where: { slug },
        select: { id: true },
      })) !== null
    );
  }

  /**
   * 삭제된 같은 slug가 있으면 복구(unique 인덱스), 없으면 생성. 감사와 한 트랜잭션.
   * 상위는 같은 트랜잭션에서 잠가 확인한다(상위 삭제·비활성화와 교차 방지). 활성 slug 충돌은 P2002로 잡는다.
   */
  async createOrRestoreRegion(
    data: {
      parent_id: bigint | null;
      level: number;
      name: string;
      slug: string;
      sort_order: number;
      is_active: boolean;
      center_lat: Prisma.Decimal | null;
      center_lng: Prisma.Decimal | null;
    },
    audit: (row: AdminRegionRow) => AuditEntry,
  ): Promise<AdminRegionRow | 'parent-not-active' | 'slug-taken'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (
          data.parent_id !== null &&
          !(await lockUsableRegion(tx, data.parent_id, 1))
        ) {
          return 'parent-not-active';
        }
        const deleted = await tx.region.findFirst({
          where: { slug: data.slug, deleted_at: { not: null } },
          select: { id: true },
        });
        const row = deleted
          ? await tx.region.update({
              where: { id: deleted.id },
              data: { ...data, deleted_at: null },
              include: regionInclude,
            })
          : await tx.region.create({ data, include: regionInclude });
        await this.auditLogs.recordAudit(tx, audit(row));
        return row;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'slug-taken';
      throw error;
    }
  }

  /**
   * 잠금 뒤 트랜잭션 안에서 계층 불변식을 지킨다 — 1차 비활성화는 활성 하위가 없을 때만,
   * 2차 활성화는 상위가 활성일 때만(상위를 FOR SHARE로 잠가 비활성화·삭제와 직렬화).
   * slug는 삭제된 행까지 포함해 확인한다(전역 unique 인덱스). 경쟁으로 새는 충돌은 P2002로 잡는다.
   */
  async updateRegion(
    args: { regionId: bigint; data: Prisma.RegionUpdateInput },
    audit: (before: AdminRegionRow, after: AdminRegionRow) => AuditEntry,
  ): Promise<
    | AdminRegionRow
    | 'not-found'
    | 'slug-taken'
    | 'has-active-children'
    | 'parent-not-active'
  > {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!(await this.lockActiveRegion(tx, args.regionId))) {
          return 'not-found';
        }
        const before = await tx.region.findFirstOrThrow({
          where: { id: args.regionId },
          include: regionInclude,
        });
        if (
          typeof args.data.slug === 'string' &&
          args.data.slug !== before.slug &&
          (await tx.region.findFirst({
            where: { slug: args.data.slug, deleted_at: undefined },
            select: { id: true },
          }))
        ) {
          return 'slug-taken';
        }
        if (
          args.data.is_active === false &&
          before.level === 1 &&
          before._count.children > 0
        ) {
          return 'has-active-children';
        }
        if (
          args.data.is_active === true &&
          !before.is_active &&
          before.parent_id !== null &&
          !(await lockUsableRegion(tx, before.parent_id, 1))
        ) {
          return 'parent-not-active';
        }
        const after = await tx.region.update({
          where: { id: args.regionId },
          data: args.data,
          include: regionInclude,
        });
        await this.auditLogs.recordAudit(tx, audit(before, after));
        return after;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'slug-taken';
      throw error;
    }
  }

  /**
   * 잠금 뒤 트랜잭션 안에서 연결 매장(2차)·활성 하위(1차)를 세어 있으면 거절한다 —
   * 미리 센 값은 그 사이 새 연결로 낡을 수 있다.
   */
  async softDeleteRegion(
    regionId: bigint,
    audit: (before: AdminRegionRow) => AuditEntry,
  ): Promise<'deleted' | 'not-found' | 'has-stores' | 'has-children'> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveRegion(tx, regionId))) return 'not-found';
      const before = await tx.region.findFirstOrThrow({
        where: { id: regionId },
        include: regionInclude,
      });
      if (before._count.stores > 0) return 'has-stores';
      if (before._count.children > 0) return 'has-children';
      await tx.region.update({
        where: { id: regionId },
        data: { deleted_at: new Date() },
      });
      await this.auditLogs.recordAudit(tx, audit(before));
      return 'deleted';
    });
  }
}
