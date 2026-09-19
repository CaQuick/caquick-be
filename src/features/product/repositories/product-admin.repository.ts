import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditEntry,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  type Banner,
  type BannerPlacement,
  type CategoryType,
  Prisma,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

export type AdminCategoryRow = Prisma.CategoryGetPayload<{
  include: typeof categoryInclude;
}>;
export type AdminTagRow = Prisma.TagGetPayload<{
  include: typeof tagInclude;
}>;

const categoryInclude = {
  _count: { select: { product_categories: { where: activeWhere } } },
} as const;
const tagInclude = {
  _count: { select: { product_tags: { where: activeWhere } } },
} as const;

export type AdminProductRow = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;
export type AdminProductDetailRow = Prisma.ProductGetPayload<{
  include: typeof productDetailInclude;
}>;

const productInclude = {
  store: { select: { store_name: true, is_active: true } },
} as const;

// orderBy 배열은 as const로 readonly가 되면 Prisma 타입과 어긋나 satisfies로 고정한다
const productDetailInclude = {
  store: { select: { store_name: true, is_active: true } },
  images: {
    select: { image_url: true, deleted_at: true },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
  },
  _count: {
    select: {
      reviews: { where: activeWhere },
      order_items: { where: activeWhere },
    },
  },
} satisfies Prisma.ProductInclude;

/** 관리자 상품 관리(상품 노출·카테고리·태그·배너). 조작과 감사 기록을 한 트랜잭션으로 묶는다. */
@Injectable()
export class ProductAdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /** 행 잠금 대상 테이블(product 소유). 고정 문자열만 raw로 들어간다. */
  /**
   * 대상 행을 잠그고(FOR UPDATE) 미삭제인지 확인한다. 읽고-쓰는 조작(수정·토글·삭제)은 이 잠금
   * 뒤에 트랜잭션 안에서 다시 읽어야 한다 — 서비스가 미리 읽은 값은 다른 관리자의 커밋으로
   * 낡을 수 있어 감사 before가 틀리거나, 그 사이 삭제된 행을 되살리거나, 같은 토글이 두 번
   * 감사된다. 잠금을 기다린 쪽은 최신 커밋을 본다.
   */
  private async lockActiveRow(
    tx: Prisma.TransactionClient,
    table: 'product' | 'banner' | 'category' | 'tag',
    id: bigint,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM ${Prisma.raw(table)}
      WHERE id = ${id} AND deleted_at IS NULL
      FOR UPDATE`;
    return rows.length > 0;
  }

  // ── 배너 ──

  private bannerFilterWhere(filter: {
    placement?: BannerPlacement;
    isActive?: boolean;
  }): Prisma.BannerWhereInput {
    return {
      ...(filter.placement ? { placement: filter.placement } : {}),
      ...(filter.isActive !== undefined ? { is_active: filter.isActive } : {}),
    };
  }

  async listBanners(args: {
    placement?: BannerPlacement;
    isActive?: boolean;
    limit: number;
    cursor?: bigint;
  }): Promise<Banner[]> {
    return this.prisma.banner.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.bannerFilterWhere(args),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countBanners(filter: {
    placement?: BannerPlacement;
    isActive?: boolean;
  }): Promise<number> {
    return this.prisma.banner.count({ where: this.bannerFilterWhere(filter) });
  }

  async findBannerById(bannerId: bigint): Promise<Banner | null> {
    return this.prisma.banner.findFirst({ where: { id: bannerId } });
  }

  // 조작과 감사 기록을 한 트랜잭션으로 — 조작만 커밋되고 기록이 빠지는 상태를 막는다.

  async createBanner(
    data: Prisma.BannerUncheckedCreateInput,
    audit: (row: Banner) => AuditEntry,
  ): Promise<Banner> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.banner.create({ data });
      await this.auditLogs.recordAudit(tx, audit(row));
      return row;
    });
  }

  async updateBanner(
    args: { bannerId: bigint; data: Prisma.BannerUpdateInput },
    audit: (before: Banner, after: Banner) => AuditEntry,
  ): Promise<Banner | null> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveRow(tx, 'banner', args.bannerId))) return null;
      const before = await tx.banner.findFirstOrThrow({
        where: { id: args.bannerId },
      });
      const after = await tx.banner.update({
        where: { id: args.bannerId },
        data: args.data,
      });
      await this.auditLogs.recordAudit(tx, audit(before, after));
      return after;
    });
  }

  async softDeleteBanner(
    bannerId: bigint,
    audit: (before: Banner) => AuditEntry,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveRow(tx, 'banner', bannerId))) return false;
      const before = await tx.banner.findFirstOrThrow({
        where: { id: bannerId },
      });
      await tx.banner.update({
        where: { id: bannerId },
        data: { deleted_at: new Date() },
      });
      await this.auditLogs.recordAudit(tx, audit(before));
      return true;
    });
  }

  // ── 링크 대상 노출 가능 확인 ──
  // 구매자 배너 조회(findFirstBanner)가 대상을 visibleWhere로 게이트하므로, 저장 시점에도
  // 같은 기준으로 확인해 "저장은 됐는데 절대 안 보이는" 배너를 막는다. 루트 READ라 삭제는 자동 제외.

  async isProductVisible(productId: bigint): Promise<boolean> {
    return (
      (await this.prisma.product.findFirst({
        where: { id: productId, is_active: true, store: visibleWhere },
        select: { id: true },
      })) !== null
    );
  }

  async isStoreVisible(storeId: bigint): Promise<boolean> {
    return (
      (await this.prisma.store.findFirst({
        where: { id: storeId, is_active: true },
        select: { id: true },
      })) !== null
    );
  }

  async findVisibleCategoryType(
    categoryId: bigint,
  ): Promise<CategoryType | null> {
    const row = await this.prisma.category.findFirst({
      where: { id: categoryId, is_active: true },
      select: { category_type: true },
    });
    return row?.category_type ?? null;
  }

  // ── 상품 ──

  private productFilterWhere(filter: {
    keyword?: string;
    storeId?: bigint;
    isActive?: boolean;
  }): Prisma.ProductWhereInput {
    return {
      ...(filter.keyword ? { name: { contains: filter.keyword } } : {}),
      ...(filter.storeId !== undefined ? { store_id: filter.storeId } : {}),
      ...(filter.isActive !== undefined ? { is_active: filter.isActive } : {}),
    };
  }

  async listProducts(args: {
    keyword?: string;
    storeId?: bigint;
    isActive?: boolean;
    limit: number;
    cursor?: bigint;
  }): Promise<AdminProductRow[]> {
    return this.prisma.product.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.productFilterWhere(args),
      },
      include: productInclude,
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countProducts(filter: {
    keyword?: string;
    storeId?: bigint;
    isActive?: boolean;
  }): Promise<number> {
    return this.prisma.product.count({
      where: this.productFilterWhere(filter),
    });
  }

  async findProductById(productId: bigint): Promise<AdminProductRow | null> {
    return this.prisma.product.findFirst({
      where: { id: productId },
      include: productInclude,
    });
  }

  async findProductDetailById(
    productId: bigint,
  ): Promise<AdminProductDetailRow | null> {
    return this.prisma.product.findFirst({
      where: { id: productId },
      include: productDetailInclude,
    });
  }

  /**
   * 노출 토글. 잠금 뒤 트랜잭션 안에서 현재 값을 보고, 이미 목표값이면 갱신·감사 없이 그대로
   * 돌려준다. 없거나 그 사이 삭제됐으면 null(되살리지 않는다).
   */
  async setProductActive(
    args: { productId: bigint; isActive: boolean },
    audit: (before: AdminProductRow, after: AdminProductRow) => AuditEntry,
  ): Promise<{ row: AdminProductRow; changed: boolean } | null> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveRow(tx, 'product', args.productId))) {
        return null;
      }
      const before = await tx.product.findFirstOrThrow({
        where: { id: args.productId },
        include: productInclude,
      });
      if (before.is_active === args.isActive) {
        return { row: before, changed: false };
      }
      const after = await tx.product.update({
        where: { id: args.productId },
        data: { is_active: args.isActive },
        include: productInclude,
      });
      await this.auditLogs.recordAudit(tx, audit(before, after));
      return { row: after, changed: true };
    });
  }

  // ── 카테고리 ──

  async listCategories(args: {
    categoryType?: CategoryType;
    includeInactive: boolean;
  }): Promise<AdminCategoryRow[]> {
    return this.prisma.category.findMany({
      where: {
        ...(args.categoryType ? { category_type: args.categoryType } : {}),
        ...(args.includeInactive ? {} : { is_active: true }),
      },
      include: categoryInclude,
      orderBy: [{ category_type: 'asc' }, { sort_order: 'asc' }, { id: 'asc' }],
    });
  }

  async findCategoryById(categoryId: bigint): Promise<AdminCategoryRow | null> {
    return this.prisma.category.findFirst({
      where: { id: categoryId },
      include: categoryInclude,
    });
  }

  /** 활성(미삭제) 행 기준 이름 충돌. 삭제 행은 createOrRestore가 복구 대상으로 본다. */
  async existsActiveCategoryName(
    categoryType: CategoryType,
    name: string,
  ): Promise<boolean> {
    return (
      (await this.prisma.category.findFirst({
        where: { category_type: categoryType, name },
        select: { id: true },
      })) !== null
    );
  }

  /**
   * 같은 (type, name)의 삭제 행이 있으면 복구하고(unique 인덱스가 삭제 행도 세므로 새 행을 만들 수
   * 없다), 없으면 생성한다. 상품 연결은 복구하지 않는다. 감사 기록과 한 트랜잭션.
   */
  async createOrRestoreCategory(
    data: {
      category_type: CategoryType;
      name: string;
      description: string | null;
      sort_order: number;
      is_active: boolean;
    },
    audit: (row: AdminCategoryRow) => AuditEntry,
  ): Promise<AdminCategoryRow> {
    return this.prisma.$transaction(async (tx) => {
      // deleted_at 조건을 명시해 soft-delete 자동 필터를 우회한다(삭제 행 탐색)
      const deleted = await tx.category.findFirst({
        where: {
          category_type: data.category_type,
          name: data.name,
          deleted_at: { not: null },
        },
        select: { id: true },
      });
      const row = deleted
        ? await tx.category.update({
            where: { id: deleted.id },
            data: { ...data, deleted_at: null },
            include: categoryInclude,
          })
        : await tx.category.create({ data, include: categoryInclude });
      await this.auditLogs.recordAudit(tx, audit(row));
      return row;
    });
  }

  async updateCategory(
    args: { categoryId: bigint; data: Prisma.CategoryUpdateInput },
    audit: (before: AdminCategoryRow, after: AdminCategoryRow) => AuditEntry,
  ): Promise<AdminCategoryRow | null> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveRow(tx, 'category', args.categoryId))) {
        return null;
      }
      const before = await tx.category.findFirstOrThrow({
        where: { id: args.categoryId },
        include: categoryInclude,
      });
      const after = await tx.category.update({
        where: { id: args.categoryId },
        data: args.data,
        include: categoryInclude,
      });
      await this.auditLogs.recordAudit(tx, audit(before, after));
      return after;
    });
  }

  async softDeleteCategory(
    categoryId: bigint,
    audit: (before: AdminCategoryRow) => AuditEntry,
  ): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveRow(tx, 'category', categoryId))) return false;
      const before = await tx.category.findFirstOrThrow({
        where: { id: categoryId },
        include: categoryInclude,
      });
      await tx.category.update({
        where: { id: categoryId },
        data: { deleted_at: now },
      });
      await tx.productCategory.updateMany({
        where: { category_id: categoryId, ...activeWhere },
        data: { deleted_at: now },
      });
      await this.auditLogs.recordAudit(tx, audit(before));
      return true;
    });
  }

  // ── 태그 ──

  async listTags(args: {
    keyword?: string;
    limit: number;
    cursor?: bigint;
  }): Promise<AdminTagRow[]> {
    return this.prisma.tag.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...(args.keyword ? { name: { contains: args.keyword } } : {}),
      },
      include: tagInclude,
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countTags(filter: { keyword?: string }): Promise<number> {
    return this.prisma.tag.count({
      where: filter.keyword ? { name: { contains: filter.keyword } } : {},
    });
  }

  async findTagById(tagId: bigint): Promise<AdminTagRow | null> {
    return this.prisma.tag.findFirst({
      where: { id: tagId },
      include: tagInclude,
    });
  }

  async existsActiveTagName(name: string): Promise<boolean> {
    return (
      (await this.prisma.tag.findFirst({
        where: { name },
        select: { id: true },
      })) !== null
    );
  }

  async createOrRestoreTag(
    name: string,
    audit: (row: AdminTagRow) => AuditEntry,
  ): Promise<AdminTagRow> {
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.tag.findFirst({
        where: { name, deleted_at: { not: null } },
        select: { id: true },
      });
      const row = deleted
        ? await tx.tag.update({
            where: { id: deleted.id },
            data: { deleted_at: null },
            include: tagInclude,
          })
        : await tx.tag.create({ data: { name }, include: tagInclude });
      await this.auditLogs.recordAudit(tx, audit(row));
      return row;
    });
  }

  async updateTag(
    args: { tagId: bigint; name: string },
    audit: (before: AdminTagRow, after: AdminTagRow) => AuditEntry,
  ): Promise<AdminTagRow | null> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveRow(tx, 'tag', args.tagId))) return null;
      const before = await tx.tag.findFirstOrThrow({
        where: { id: args.tagId },
        include: tagInclude,
      });
      const after = await tx.tag.update({
        where: { id: args.tagId },
        data: { name: args.name },
        include: tagInclude,
      });
      await this.auditLogs.recordAudit(tx, audit(before, after));
      return after;
    });
  }

  async softDeleteTag(
    tagId: bigint,
    audit: (before: AdminTagRow) => AuditEntry,
  ): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveRow(tx, 'tag', tagId))) return false;
      const before = await tx.tag.findFirstOrThrow({
        where: { id: tagId },
        include: tagInclude,
      });
      await tx.tag.update({ where: { id: tagId }, data: { deleted_at: now } });
      await tx.productTag.updateMany({
        where: { tag_id: tagId, ...activeWhere },
        data: { deleted_at: now },
      });
      await this.auditLogs.recordAudit(tx, audit(before));
      return true;
    });
  }

  /** 대시보드 집계(dashboard feature가 배럴로 소비). */
  async countActiveProducts(): Promise<number> {
    return this.prisma.product.count({ where: { is_active: true } });
  }
}
