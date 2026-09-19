import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditEntry,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { lockUsableRegion } from '@/features/region';
import { Prisma, type Store } from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

export type AdminStoreDetailRow = Prisma.StoreGetPayload<{
  include: typeof storeDetailInclude;
}>;

const storeDetailInclude = {
  seller_account: {
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      credential: { select: { username: true, deleted_at: true } },
    },
  },
  _count: {
    select: {
      products: { where: activeWhere },
      order_items: { where: activeWhere },
    },
  },
} as const;

/** 관리자 매장 관리(목록·상세·기본 정보 수정·노출 토글). 조작과 감사 기록을 한 트랜잭션으로 묶는다. */
@Injectable()
export class StoreAdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /**
   * 대상 행을 잠그고(FOR UPDATE) 미삭제인지 확인한다. 읽고-쓰는 조작(수정·토글·삭제)은 이 잠금
   * 뒤에 트랜잭션 안에서 다시 읽어야 한다 — 서비스가 미리 읽은 값은 다른 관리자의 커밋으로 낡을 수 있다.
   */
  private async lockActiveStore(
    tx: Prisma.TransactionClient,
    id: bigint,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM store
      WHERE id = ${id} AND deleted_at IS NULL
      FOR UPDATE`;
    return rows.length > 0;
  }

  // ── 매장 ──

  private storeFilterWhere(filter: {
    keyword?: string;
    isActive?: boolean;
    regionId?: bigint;
  }): Prisma.StoreWhereInput {
    return {
      ...(filter.keyword ? { store_name: { contains: filter.keyword } } : {}),
      ...(filter.isActive !== undefined ? { is_active: filter.isActive } : {}),
      ...(filter.regionId !== undefined ? { region_id: filter.regionId } : {}),
    };
  }

  async listStores(args: {
    keyword?: string;
    isActive?: boolean;
    regionId?: bigint;
    limit: number;
    cursor?: bigint;
  }): Promise<Store[]> {
    return this.prisma.store.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.storeFilterWhere(args),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countStores(filter: {
    keyword?: string;
    isActive?: boolean;
    regionId?: bigint;
  }): Promise<number> {
    return this.prisma.store.count({ where: this.storeFilterWhere(filter) });
  }

  async findStoreById(storeId: bigint): Promise<Store | null> {
    return this.prisma.store.findFirst({ where: { id: storeId } });
  }

  async findStoreDetailById(
    storeId: bigint,
  ): Promise<AdminStoreDetailRow | null> {
    return this.prisma.store.findFirst({
      where: { id: storeId },
      include: storeDetailInclude,
    });
  }

  /** regionId(연결)는 같은 트랜잭션에서 지역을 잠가 확인한다 — 미리 확인한 값은 지역 삭제와 교차하면 낡는다. */
  async updateStore(
    args: { storeId: bigint; data: Prisma.StoreUpdateInput; regionId?: bigint },
    audit: (before: Store, after: Store) => AuditEntry,
  ): Promise<Store | null | 'region-not-selectable'> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveStore(tx, args.storeId))) return null;
      if (
        args.regionId !== undefined &&
        !(await lockUsableRegion(tx, args.regionId, 2))
      ) {
        return 'region-not-selectable';
      }
      const before = await tx.store.findFirstOrThrow({
        where: { id: args.storeId },
      });
      const after = await tx.store.update({
        where: { id: args.storeId },
        data: args.data,
      });
      await this.auditLogs.createAuditLog(audit(before, after), tx);
      return after;
    });
  }

  /**
   * 노출 토글. 잠금 뒤 트랜잭션 안에서 현재 값을 보고, 이미 목표값이면 갱신·감사 없이 그대로
   * 돌려준다(두 관리자가 동시에 같은 값으로 바꿔도 감사는 1건). 없거나 삭제됐으면 null.
   */
  async setStoreActive(
    args: { storeId: bigint; isActive: boolean },
    audit: (before: Store, after: Store) => AuditEntry,
  ): Promise<{ row: Store; changed: boolean } | null> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveStore(tx, args.storeId))) return null;
      const before = await tx.store.findFirstOrThrow({
        where: { id: args.storeId },
      });
      if (before.is_active === args.isActive) {
        return { row: before, changed: false };
      }
      const after = await tx.store.update({
        where: { id: args.storeId },
        data: { is_active: args.isActive },
      });
      await this.auditLogs.createAuditLog(audit(before, after), tx);
      return { row: after, changed: true };
    });
  }
}
