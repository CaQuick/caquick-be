import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditEntry,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  lockActiveReviewRow,
  lockParentReviewOfComment,
  resolvePendingReports,
} from '@/features/review';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  type Banner,
  type BannerPlacement,
  type CategoryType,
  type NotificationType,
  Prisma,
  type ReviewReport,
  type Store,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

/** 행 잠금 대상 테이블. 고정 문자열만 raw로 들어간다. */
type LockableTable =
  'store' | 'product' | 'banner' | 'category' | 'tag' | 'region';

/** 작성자 닉네임(탈퇴 판정용 deleted_at 동반). */
const authorInclude = {
  account: {
    select: { user_profile: { select: { nickname: true, deleted_at: true } } },
  },
} as const;

export type AdminReviewReportDetailRow = Prisma.ReviewReportGetPayload<{
  include: typeof reviewReportDetailInclude;
}>;
const reviewReportDetailInclude = {
  review: {
    select: {
      id: true,
      account_id: true,
      store_id: true,
      content: true,
      deleted_at: true,
      ...authorInclude,
    },
  },
  review_comment: {
    select: {
      id: true,
      review_id: true,
      account_id: true,
      content: true,
      deleted_at: true,
      review: { select: { store_id: true } },
      ...authorInclude,
    },
  },
} as const;

export type AdminReviewRow = Prisma.ReviewGetPayload<{
  include: typeof adminReviewInclude;
}>;
const adminReviewInclude = {
  store: { select: { store_name: true } },
  ...authorInclude,
  _count: {
    select: {
      comments: { where: activeWhere },
      likes: { where: activeWhere },
    },
  },
} as const;

export type AdminReviewCommentRow = Prisma.ReviewCommentGetPayload<{
  include: typeof adminReviewCommentInclude;
}>;
const adminReviewCommentInclude = { ...authorInclude } as const;

export interface AdminAuditLogFilter {
  actorAccountId?: bigint;
  storeId?: bigint;
  targetType?: AuditTargetType;
  targetId?: bigint;
  action?: AuditActionType;
  fromCreatedAt?: Date;
  toCreatedAt?: Date;
}

export type AdminAuditLogRow = Prisma.AuditLogGetPayload<
  Record<string, never>
> & {
  actor: { account_type: AccountType } | null;
};

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

@Injectable()
export class AdminRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /**
   * 대상 행을 잠그고(FOR UPDATE) 미삭제인지 확인한다. 읽고-쓰는 조작(수정·토글·삭제)은 이 잠금
   * 뒤에 트랜잭션 안에서 다시 읽어야 한다 — 서비스가 미리 읽은 값은 다른 관리자의 커밋으로
   * 낡을 수 있어 감사 before가 틀리거나, 그 사이 삭제된 행을 되살리거나, 같은 토글이 두 번
   * 감사된다. 잠금을 기다린 쪽은 최신 커밋을 본다.
   */
  private async lockActiveRow(
    tx: Prisma.TransactionClient,
    table: LockableTable,
    id: bigint,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM ${Prisma.raw(table)}
      WHERE id = ${id} AND deleted_at IS NULL
      FOR UPDATE`;
    return rows.length > 0;
  }

  /**
   * 지역 FK를 잇는 쓰기(매장 연결·하위 생성·2차 재활성화)는 같은 트랜잭션에서 지역 행을 FOR SHARE로
   * 잠근다 — 지역 삭제·비활성화(FOR UPDATE)와 직렬화되어, 그쪽 커밋 뒤 FK 갱신만 통과해 삭제된
   * 지역에 매달리는 일이 없다. 잠긴 시점에 쓸 수 있는 상태(레벨·활성·미삭제)여야 true.
   */
  private async lockUsableRegion(
    tx: Prisma.TransactionClient,
    regionId: bigint,
    level: 1 | 2,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM region
      WHERE id = ${regionId} AND level = ${level}
        AND is_active = 1 AND deleted_at IS NULL
      FOR SHARE`;
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
      await this.auditLogs.createAuditLog(audit(row), tx);
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
      await this.auditLogs.createAuditLog(audit(before, after), tx);
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
      await this.auditLogs.createAuditLog(audit(before), tx);
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

  // ── 판매자 계정 ──

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
      if (!(await this.lockActiveRow(tx, 'store', args.storeId))) return null;
      if (
        args.regionId !== undefined &&
        !(await this.lockUsableRegion(tx, args.regionId, 2))
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
      if (!(await this.lockActiveRow(tx, 'store', args.storeId))) return null;
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
      await this.auditLogs.createAuditLog(audit(before, after), tx);
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
      await this.auditLogs.createAuditLog(audit(row), tx);
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
      await this.auditLogs.createAuditLog(audit(before, after), tx);
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
      await this.auditLogs.createAuditLog(audit(before), tx);
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
      await this.auditLogs.createAuditLog(audit(row), tx);
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
      await this.auditLogs.createAuditLog(audit(before, after), tx);
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
      await this.auditLogs.createAuditLog(audit(before), tx);
      return true;
    });
  }

  // ── 리뷰 모더레이션 ──

  /**
   * 대상 FK가 둘 다 비워진 신고(대상 하드 삭제 시 ON DELETE SET NULL)는 없는 것으로 본다 —
   * 앱 경로는 soft-delete뿐이라 정상 흐름에서는 생기지 않지만, 생기면 리뷰 신고로 잘못 해석돼
   * `review_id: null` 필터가 댓글 신고 전부에 번진다.
   */
  private readonly targetedReportWhere: Prisma.ReviewReportWhereInput = {
    OR: [{ review_id: { not: null } }, { review_comment_id: { not: null } }],
  };

  private reviewReportFilterWhere(filter: {
    status: 'PENDING' | 'RESOLVED' | 'REJECTED' | null;
    targetType?: 'REVIEW' | 'REVIEW_COMMENT';
  }): Prisma.ReviewReportWhereInput {
    return {
      ...this.targetedReportWhere,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.targetType === 'REVIEW' ? { review_id: { not: null } } : {}),
      ...(filter.targetType === 'REVIEW_COMMENT'
        ? { review_comment_id: { not: null } }
        : {}),
    };
  }

  async listReviewReports(args: {
    status: 'PENDING' | 'RESOLVED' | 'REJECTED' | null;
    targetType?: 'REVIEW' | 'REVIEW_COMMENT';
    limit: number;
    cursor?: bigint;
  }): Promise<ReviewReport[]> {
    return this.prisma.reviewReport.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.reviewReportFilterWhere(args),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countReviewReports(filter: {
    status: 'PENDING' | 'RESOLVED' | 'REJECTED' | null;
    targetType?: 'REVIEW' | 'REVIEW_COMMENT';
  }): Promise<number> {
    return this.prisma.reviewReport.count({
      where: this.reviewReportFilterWhere(filter),
    });
  }

  async findReviewReportDetailById(
    reportId: bigint,
  ): Promise<AdminReviewReportDetailRow | null> {
    return this.prisma.reviewReport.findFirst({
      where: { id: reportId, ...this.targetedReportWhere },
      include: reviewReportDetailInclude,
    });
  }

  async resolveReviewReport(args: {
    reportId: bigint;
    action: 'DELETE_TARGET' | 'REJECT';
    note: string | null;
    actorAccountId: bigint;
  }): Promise<ReviewReport | 'not-found' | 'already-resolved'> {
    const now = new Date();
    // 대상 id는 불변이라 트랜잭션 밖에서 읽는다 — 트랜잭션 안의 첫 일반 읽기가 REPEATABLE READ
    // 스냅샷을 고정하므로, 잠금보다 먼저 읽으면 잠금 뒤 읽는 상태가 낡는다
    const peek = await this.prisma.reviewReport.findFirst({
      where: { id: args.reportId },
      select: { review_id: true, review_comment_id: true },
    });
    if (!peek) return 'not-found';
    // 대상 FK가 둘 다 비워진 신고는 없는 것으로 본다(targetedReportWhere와 같은 기준)
    const target = peek.review_comment_id
      ? { kind: 'review_comment' as const, id: peek.review_comment_id }
      : peek.review_id
        ? { kind: 'review' as const, id: peek.review_id }
        : null;
    if (!target) return 'not-found';

    return this.prisma.$transaction(async (tx) => {
      // 잠금 순서: (부모 리뷰 →) 대상(리뷰/댓글) → 신고. 강제 삭제 경로도 같은 순서라, 같은 대상의
      // 다른 신고를 동시에 처리하는 두 트랜잭션이 서로의 잠금을 기다리는 교착이 생기지 않는다.
      // 대상이 이미 삭제됐으면 잠기지 않지만 신고 처리는 계속돼야 한다
      if (target.kind === 'review_comment') {
        await lockParentReviewOfComment(tx, target.id);
      }
      await lockActiveReviewRow(tx, target.kind, target.id);

      if (!(await lockActiveReviewRow(tx, 'review_report', args.reportId))) {
        return 'not-found';
      }
      const report = await tx.reviewReport.findFirstOrThrow({
        where: { id: args.reportId },
      });
      if (report.status !== 'PENDING') return 'already-resolved';

      if (args.action === 'DELETE_TARGET') {
        await this.softDeleteTargetTx(tx, target, now, args.actorAccountId, {
          reportId: report.id,
          note: args.note,
        });
        // 같은 대상의 다른 미처리 신고도 함께 닫는다(이 건 포함). 리뷰면 함께 내려간 댓글 신고까지
        await tx.reviewReport.updateMany({
          where: {
            status: 'PENDING',
            ...(target.kind === 'review'
              ? {
                  OR: [
                    { review_id: target.id },
                    { review_comment: { review_id: target.id } },
                  ],
                }
              : { review_comment_id: target.id }),
          },
          data: {
            status: 'RESOLVED',
            resolved_by_account_id: args.actorAccountId,
            resolved_at: now,
            resolution_note: args.note,
            updated_at: now,
          },
        });
      } else {
        await tx.reviewReport.update({
          where: { id: report.id },
          data: {
            status: 'REJECTED',
            resolved_by_account_id: args.actorAccountId,
            resolved_at: now,
            resolution_note: args.note,
          },
        });
      }

      await this.auditLogs.createAuditLog(
        {
          actorAccountId: args.actorAccountId,
          storeId: null,
          targetType: AuditTargetType.REVIEW_REPORT,
          targetId: report.id,
          action: AuditActionType.STATUS_CHANGE,
          beforeJson: { status: 'PENDING' },
          afterJson: {
            status: args.action === 'DELETE_TARGET' ? 'RESOLVED' : 'REJECTED',
            action: args.action,
            note: args.note,
          },
        },
        tx,
      );
      return tx.reviewReport.findFirstOrThrow({ where: { id: report.id } });
    });
  }

  async adminSoftDeleteReview(args: {
    reviewId: bigint;
    reason: string;
    actorAccountId: bigint;
  }): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockActiveReviewRow(tx, 'review', args.reviewId)))
        return false;
      await this.softDeleteTargetTx(
        tx,
        { kind: 'review', id: args.reviewId },
        now,
        args.actorAccountId,
        { reportId: null, note: args.reason },
      );
      // 리뷰와 함께 내려간 댓글을 겨냥한 신고도 닫는다(작성자 삭제 경로와 같은 범위)
      await resolvePendingReports(tx, {
        where: {
          OR: [
            { review_id: args.reviewId },
            { review_comment: { review_id: args.reviewId } },
          ],
        },
        now,
        resolvedByAccountId: args.actorAccountId,
        note: args.reason,
      });
      return true;
    });
  }

  async adminSoftDeleteReviewComment(args: {
    commentId: bigint;
    reason: string;
    actorAccountId: bigint;
  }): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await lockParentReviewOfComment(tx, args.commentId);
      if (!(await lockActiveReviewRow(tx, 'review_comment', args.commentId))) {
        return false;
      }
      await this.softDeleteTargetTx(
        tx,
        { kind: 'review_comment', id: args.commentId },
        now,
        args.actorAccountId,
        { reportId: null, note: args.reason },
      );
      await resolvePendingReports(tx, {
        where: { review_comment_id: args.commentId },
        now,
        resolvedByAccountId: args.actorAccountId,
        note: args.reason,
      });
      return true;
    });
  }

  /**
   * 대상 soft-delete + DELETE 감사. 리뷰는 작성자 본인 삭제(user feature)와 같은 범위로
   * 사진·댓글을 함께 내린다 — 리뷰 재작성이 같은 id를 복원하므로 남겨 두면 되살아난다.
   * 이미 삭제된 대상이면 조용히 지나간다(신고 처리는 계속돼야 한다).
   */
  private async softDeleteTargetTx(
    tx: Prisma.TransactionClient,
    target: { kind: 'review' | 'review_comment'; id: bigint },
    now: Date,
    actorAccountId: bigint,
    meta: { reportId: bigint | null; note: string | null },
  ): Promise<void> {
    if (target.kind === 'review') {
      const review = await tx.review.findFirst({
        where: { id: target.id },
        select: { store_id: true },
      });
      if (!review) return;
      await tx.review.update({
        where: { id: target.id },
        data: { deleted_at: now },
      });
      await tx.reviewMedia.updateMany({
        where: { review_id: target.id, ...activeWhere },
        data: { deleted_at: now },
      });
      await tx.reviewComment.updateMany({
        where: { review_id: target.id, ...activeWhere },
        data: { deleted_at: now },
      });
      await this.auditLogs.createAuditLog(
        {
          actorAccountId,
          storeId: review.store_id,
          targetType: AuditTargetType.REVIEW,
          targetId: target.id,
          action: AuditActionType.DELETE,
          afterJson: {
            reportId: meta.reportId?.toString() ?? null,
            reason: meta.note,
          },
        },
        tx,
      );
      return;
    }
    const comment = await tx.reviewComment.findFirst({
      where: { id: target.id },
      select: { review: { select: { store_id: true } } },
    });
    if (!comment) return;
    await tx.reviewComment.update({
      where: { id: target.id },
      data: { deleted_at: now },
    });
    await this.auditLogs.createAuditLog(
      {
        actorAccountId,
        storeId: comment.review.store_id,
        targetType: AuditTargetType.REVIEW_COMMENT,
        targetId: target.id,
        action: AuditActionType.DELETE,
        afterJson: {
          reportId: meta.reportId?.toString() ?? null,
          reason: meta.note,
        },
      },
      tx,
    );
  }

  // ── 리뷰·댓글 조회(관리자) ──

  private reviewFilterWhere(filter: {
    keyword?: string;
    storeId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
  }): Prisma.ReviewWhereInput {
    return {
      ...(filter.keyword ? { content: { contains: filter.keyword } } : {}),
      ...(filter.storeId !== undefined ? { store_id: filter.storeId } : {}),
      ...(filter.accountId !== undefined
        ? { account_id: filter.accountId }
        : {}),
      // deleted_at 키를 명시하면 soft-delete 자동 필터가 빠진다(삭제 포함 조회)
      ...(filter.includeDeleted ? { deleted_at: undefined } : {}),
    };
  }

  async listReviews(args: {
    keyword?: string;
    storeId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
    limit: number;
    cursor?: bigint;
  }): Promise<AdminReviewRow[]> {
    return this.prisma.review.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.reviewFilterWhere(args),
      },
      include: adminReviewInclude,
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countReviews(filter: {
    keyword?: string;
    storeId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
  }): Promise<number> {
    return this.prisma.review.count({ where: this.reviewFilterWhere(filter) });
  }

  private reviewCommentFilterWhere(filter: {
    reviewId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
  }): Prisma.ReviewCommentWhereInput {
    return {
      ...(filter.reviewId !== undefined ? { review_id: filter.reviewId } : {}),
      ...(filter.accountId !== undefined
        ? { account_id: filter.accountId }
        : {}),
      ...(filter.includeDeleted ? { deleted_at: undefined } : {}),
    };
  }

  async listReviewComments(args: {
    reviewId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
    limit: number;
    cursor?: bigint;
  }): Promise<AdminReviewCommentRow[]> {
    return this.prisma.reviewComment.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.reviewCommentFilterWhere(args),
      },
      include: adminReviewCommentInclude,
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countReviewComments(filter: {
    reviewId?: bigint;
    accountId?: bigint;
    includeDeleted: boolean;
  }): Promise<number> {
    return this.prisma.reviewComment.count({
      where: this.reviewCommentFilterWhere(filter),
    });
  }

  // ── 알림 발송 ──

  async listActiveUserAccountIds(args: {
    afterId?: bigint;
    limit: number;
  }): Promise<bigint[]> {
    const rows = await this.prisma.account.findMany({
      where: {
        account_type: AccountType.USER,
        status: 'ACTIVE',
        ...(args.afterId !== undefined ? { id: { gt: args.afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: args.limit,
    });
    return rows.map((r) => r.id);
  }

  async filterActiveUserAccountIds(ids: bigint[]): Promise<bigint[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.account.findMany({
      where: {
        id: { in: ids },
        account_type: AccountType.USER,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** event는 없다 — 시스템 이벤트가 아니다. */
  async createNotifications(
    accountIds: bigint[],
    payload: { type: NotificationType; title: string; body: string },
  ): Promise<number> {
    if (accountIds.length === 0) return 0;
    const result = await this.prisma.notification.createMany({
      data: accountIds.map((account_id) => ({
        account_id,
        type: payload.type,
        title: payload.title,
        body: payload.body,
      })),
    });
    return result.count;
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
          !(await this.lockUsableRegion(tx, data.parent_id, 1))
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
        await this.auditLogs.createAuditLog(audit(row), tx);
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
        if (!(await this.lockActiveRow(tx, 'region', args.regionId))) {
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
          !(await this.lockUsableRegion(tx, before.parent_id, 1))
        ) {
          return 'parent-not-active';
        }
        const after = await tx.region.update({
          where: { id: args.regionId },
          data: args.data,
          include: regionInclude,
        });
        await this.auditLogs.createAuditLog(audit(before, after), tx);
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
      if (!(await this.lockActiveRow(tx, 'region', regionId)))
        return 'not-found';
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
      await this.auditLogs.createAuditLog(audit(before), tx);
      return 'deleted';
    });
  }

  // ── 감사 로그 전역 ──

  private auditLogWhere(args: AdminAuditLogFilter): Prisma.AuditLogWhereInput {
    return {
      ...(args.actorAccountId !== undefined
        ? { actor_account_id: args.actorAccountId }
        : {}),
      ...(args.storeId !== undefined ? { store_id: args.storeId } : {}),
      ...(args.targetType ? { target_type: args.targetType } : {}),
      ...(args.targetId !== undefined ? { target_id: args.targetId } : {}),
      ...(args.action ? { action: args.action } : {}),
      ...(args.fromCreatedAt || args.toCreatedAt
        ? {
            created_at: {
              ...(args.fromCreatedAt ? { gte: args.fromCreatedAt } : {}),
              ...(args.toCreatedAt ? { lte: args.toCreatedAt } : {}),
            },
          }
        : {}),
    };
  }

  async countAuditLogs(args: AdminAuditLogFilter): Promise<number> {
    return this.prisma.auditLog.count({ where: this.auditLogWhere(args) });
  }

  async listAuditLogs(
    args: AdminAuditLogFilter & { limit: number; cursor?: bigint },
  ): Promise<AdminAuditLogRow[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.auditLogWhere(args),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
    // AuditLog는 계정 FK가 없다(계정이 지워져도 기록을 남기기 위해). 행위자 종류는 한 번에 붙인다
    const actorIds = [...new Set(rows.map((r) => r.actor_account_id))];
    const actors = actorIds.length
      ? await this.prisma.account.findMany({
          where: { id: { in: actorIds }, deleted_at: undefined },
          select: { id: true, account_type: true },
        })
      : [];
    const typeById = new Map(
      actors.map((a) => [a.id.toString(), a.account_type]),
    );
    return rows.map((r) => ({
      ...r,
      actor: typeById.has(r.actor_account_id.toString())
        ? { account_type: typeById.get(r.actor_account_id.toString())! }
        : null,
    }));
  }

  // ── 대시보드 집계 ──

  async countAccountsCreatedBetween(
    accountType: AccountType,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.account.count({
      where: { account_type: accountType, created_at: { gte: from, lte: to } },
    });
  }

  async aggregateOrdersBetween(
    from: Date,
    to: Date,
  ): Promise<{
    counts: {
      submitted: number;
      confirmed: number;
      made: number;
      pickedUp: number;
      canceled: number;
    };
    amountSum: number;
  }> {
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: { created_at: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { total_price: true },
    });
    const counts = {
      submitted: 0,
      confirmed: 0,
      made: 0,
      pickedUp: 0,
      canceled: 0,
    };
    let amountSum = 0;
    for (const g of grouped) {
      const n = g._count._all;
      switch (g.status) {
        case 'SUBMITTED':
          counts.submitted = n;
          break;
        case 'CONFIRMED':
          counts.confirmed = n;
          break;
        case 'MADE':
          counts.made = n;
          break;
        case 'PICKED_UP':
          counts.pickedUp = n;
          break;
        case 'CANCELED':
          counts.canceled = n;
          break;
      }
      if (g.status !== 'CANCELED') amountSum += g._sum.total_price ?? 0;
    }
    return { counts, amountSum };
  }

  async countActiveStores(): Promise<number> {
    return this.prisma.store.count({ where: { is_active: true } });
  }

  async countActiveProducts(): Promise<number> {
    return this.prisma.product.count({ where: { is_active: true } });
  }

  async countPendingReviewReports(): Promise<number> {
    return this.prisma.reviewReport.count({ where: { status: 'PENDING' } });
  }
}
