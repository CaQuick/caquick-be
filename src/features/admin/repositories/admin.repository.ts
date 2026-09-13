import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  type AccountStatus,
  type Banner,
  type BannerPlacement,
  type CategoryType,
  Prisma,
  type ReviewReport,
  type Store,
} from '@prisma/client';

import { USERNAME_TAKEN } from '@/features/admin/constants/admin-error-messages';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

/** 행 잠금 대상 테이블. 고정 문자열만 raw로 들어간다. */
type LockableTable =
  | 'store'
  | 'product'
  | 'banner'
  | 'category'
  | 'tag'
  | 'review'
  | 'review_comment'
  | 'review_report';

/** 조작과 함께 남길 감사 기록 인자. */
export type AuditEntry = Parameters<IAuditLogRepository['createAuditLog']>[0];

/** 관리자 계정 행 + 자격증명 요약. 목록·상세·생성이 같은 모양을 쓴다. */
export type AdminAccountRow = Prisma.AccountGetPayload<{
  include: typeof adminAccountInclude;
}>;

/** 작성자 닉네임(탈퇴 판정용 deleted_at 동반). */
const authorInclude = {
  account: {
    select: { user_profile: { select: { nickname: true, deleted_at: true } } },
  },
} as const;

/** 신고 상세 행 + 대상 원문(삭제 여부 포함). */
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

/** 리뷰 행(관리자 시점) + 매장명·작성자·집계(삭제 제외). */
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

/** 리뷰 댓글 행 + 작성자. */
export type AdminReviewCommentRow = Prisma.ReviewCommentGetPayload<{
  include: typeof adminReviewCommentInclude;
}>;
const adminReviewCommentInclude = { ...authorInclude } as const;

/** 카테고리 행 + 연결 상품 수(삭제 연결 제외). */
export type AdminCategoryRow = Prisma.CategoryGetPayload<{
  include: typeof categoryInclude;
}>;
/** 태그 행 + 연결 상품 수(삭제 연결 제외). */
export type AdminTagRow = Prisma.TagGetPayload<{
  include: typeof tagInclude;
}>;

const categoryInclude = {
  _count: { select: { product_categories: { where: activeWhere } } },
} as const;
const tagInclude = {
  _count: { select: { product_tags: { where: activeWhere } } },
} as const;

/** 상품 행 + 소속 매장명. */
export type AdminProductRow = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;
/** 상품 상세 행 + 매장 상태·이미지·집계(삭제 제외). */
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

/** 매장 상세 행 + 소유 판매자 요약 + 집계(삭제 제외). */
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

/** 구매자 계정 행 + 프로필·연동 소셜·활동 집계. */
export type AdminUserRow = Prisma.AccountGetPayload<{
  include: typeof userAccountInclude;
}>;

const userAccountInclude = {
  user_profile: {
    select: {
      nickname: true,
      phone_number: true,
      onboarding_completed_at: true,
      deleted_at: true,
    },
  },
  account_identities: { select: { provider: true, deleted_at: true } },
  // 집계는 삭제 제외(relation count filter)
  _count: {
    select: {
      orders: { where: activeWhere },
      reviews: { where: activeWhere },
    },
  },
} as const;

/** 판매자 계정 행 + 자격증명·프로필·매장 요약. nested는 soft-delete 자동 필터 밖이라 deleted_at을 함께 읽는다. */
export type AdminSellerRow = Prisma.AccountGetPayload<{
  include: typeof sellerAccountInclude;
}>;

const sellerAccountInclude = {
  // nested relation은 soft-delete 자동 필터 밖 — deleted_at을 읽어 매퍼가 삭제된 자격증명을 없는 것으로 본다
  credential: {
    select: {
      username: true,
      must_change_password: true,
      last_login_at: true,
      deleted_at: true,
    },
  },
  seller_profile: {
    select: {
      business_name: true,
      business_phone: true,
      website_url: true,
      deleted_at: true,
    },
  },
  store: {
    select: {
      id: true,
      store_name: true,
      store_phone: true,
      address_full: true,
      is_active: true,
      deleted_at: true,
    },
  },
} as const;

const adminAccountInclude = {
  // nested relation은 soft-delete 자동 필터 밖 — deleted_at을 읽어 매퍼가 삭제된 자격증명을 없는 것으로 본다
  credential: {
    select: {
      username: true,
      must_change_password: true,
      last_login_at: true,
      deleted_at: true,
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

  async findAdminAccountContext(accountId: bigint) {
    return this.prisma.account.findFirst({
      where: { id: accountId },
      select: { id: true, account_type: true, status: true },
    });
  }

  async findAdminAccountById(
    accountId: bigint,
  ): Promise<AdminAccountRow | null> {
    return this.prisma.account.findFirst({
      where: { id: accountId, account_type: AccountType.ADMIN },
      include: adminAccountInclude,
    });
  }

  async listAdminAccounts(args: {
    limit: number;
    cursor?: bigint;
  }): Promise<AdminAccountRow[]> {
    return this.prisma.account.findMany({
      where: {
        account_type: AccountType.ADMIN,
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
      },
      include: adminAccountInclude,
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countAdminAccounts(): Promise<number> {
    return this.prisma.account.count({
      where: { account_type: AccountType.ADMIN },
    });
  }

  async existsCredentialUsername(username: string): Promise<boolean> {
    const found = await this.prisma.accountCredential.findFirst({
      where: { username },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * 계정 + 자격증명 + 감사 기록을 한 트랜잭션으로 만든다 — 특권 계정이 감사 기록 없이
   * 남는 상태를 막는다(감사 기록 실패 시 계정도 롤백).
   * username unique 충돌(P2002)은 사전 조회를 지나친 경쟁·soft-delete 잔재 케이스라
   * 여기서 도메인 예외로 좁힌다(Prisma 원문 에러는 소스 경로가 500 본문으로 샌다).
   */
  async createAdminAccount(args: {
    actorAccountId: bigint;
    username: string;
    passwordHash: string;
    email: string | null;
    name: string | null;
  }): Promise<AdminAccountRow> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: {
            account_type: AccountType.ADMIN,
            status: 'ACTIVE',
            email: args.email,
            name: args.name,
          },
        });
        await tx.accountCredential.create({
          data: {
            account_id: account.id,
            username: args.username,
            password_hash: args.passwordHash,
            must_change_password: true,
          },
        });
        await this.auditLogs.createAuditLog(
          {
            actorAccountId: args.actorAccountId,
            storeId: null,
            targetType: AuditTargetType.ACCOUNT,
            targetId: account.id,
            action: AuditActionType.CREATE,
            afterJson: { accountType: 'ADMIN', username: args.username },
          },
          tx,
        );
        return tx.account.findFirstOrThrow({
          where: { id: account.id },
          include: adminAccountInclude,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(USERNAME_TAKEN);
      }
      throw error;
    }
  }

  /**
   * 대상 행을 잠그고(FOR UPDATE) 미삭제인지 확인한다. 읽고-쓰는 조작(수정·토글·삭제)은 이 잠금
   * 뒤에 트랜잭션 안에서 다시 읽어야 한다 — 서비스가 미리 읽은 값은 다른 관리자의 커밋으로
   * 낡을 수 있어 감사 before가 틀리거나, 그 사이 삭제된 행을 되살리거나, 같은 토글이 두 번
   * 감사된다. 잠금을 기다린 쪽은 최신 커밋을 본다.
   * @returns 없거나 삭제됐으면 false
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
   * 댓글을 잠그기 전에 부모 리뷰부터 잠근다(리뷰 → 댓글 → 신고). 리뷰 삭제 경로(관리자·작성자)가
   * 리뷰를 잠근 뒤 신고·댓글을 닫으므로, 댓글부터 잠그면 신고 행을 사이에 두고 교착한다.
   * 리뷰가 이미 삭제됐어도 잠근다 — 순서만 맞으면 된다.
   */
  private async lockParentReviewOfComment(
    tx: Prisma.TransactionClient,
    commentId: bigint,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT r.id FROM review r
      JOIN review_comment c ON c.review_id = r.id
      WHERE c.id = ${commentId}
      FOR UPDATE OF r`;
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

  /** 목록과 같은 조건(커서 제외)으로 센다. */
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

  /** 잠금 → 트랜잭션 안에서 before 읽기 → 갱신 → 감사. 없거나 삭제됐으면 null. */
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

  /** 잠금 → soft-delete → 감사. 없거나 이미 삭제됐으면 false. */
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

  /** 노출 가능한 카테고리의 종류. 없거나 비활성이면 null. */
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

  private sellerFilterWhere(filter: {
    keyword?: string;
    status?: AccountStatus;
  }): Prisma.AccountWhereInput {
    return {
      account_type: AccountType.SELLER,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.keyword
        ? {
            OR: [
              { email: { contains: filter.keyword } },
              { name: { contains: filter.keyword } },
              {
                credential: {
                  ...activeWhere,
                  username: { contains: filter.keyword },
                },
              },
              {
                store: {
                  ...activeWhere,
                  store_name: { contains: filter.keyword },
                },
              },
            ],
          }
        : {}),
    };
  }

  async listSellerAccounts(args: {
    keyword?: string;
    status?: AccountStatus;
    limit: number;
    cursor?: bigint;
  }): Promise<AdminSellerRow[]> {
    return this.prisma.account.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.sellerFilterWhere(args),
      },
      include: sellerAccountInclude,
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countSellerAccounts(filter: {
    keyword?: string;
    status?: AccountStatus;
  }): Promise<number> {
    return this.prisma.account.count({ where: this.sellerFilterWhere(filter) });
  }

  async findSellerAccountById(
    accountId: bigint,
  ): Promise<AdminSellerRow | null> {
    return this.prisma.account.findFirst({
      where: { id: accountId, account_type: AccountType.SELLER },
      include: sellerAccountInclude,
    });
  }

  /** 온보딩 시 지정 가능한 지역: 활성 2차(시군구). */
  async isRegionSelectable(regionId: bigint): Promise<boolean> {
    return (
      (await this.prisma.region.findFirst({
        where: { id: regionId, level: 2, is_active: true },
        select: { id: true },
      })) !== null
    );
  }

  /**
   * 계정 + 자격증명 + 사업자 프로필 + 매장 + 감사 기록을 한 트랜잭션으로 만든다.
   * username 충돌(P2002)은 도메인 예외로 좁힌다.
   */
  async createSellerAccount(args: {
    actorAccountId: bigint;
    username: string;
    passwordHash: string;
    email: string | null;
    name: string | null;
    profile: Omit<Prisma.SellerProfileUncheckedCreateInput, 'account_id'>;
    store: Omit<Prisma.StoreUncheckedCreateInput, 'seller_account_id'>;
  }): Promise<AdminSellerRow> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: {
            account_type: AccountType.SELLER,
            status: 'ACTIVE',
            email: args.email,
            name: args.name,
          },
        });
        await tx.accountCredential.create({
          data: {
            account_id: account.id,
            username: args.username,
            password_hash: args.passwordHash,
            must_change_password: true,
          },
        });
        await tx.sellerProfile.create({
          data: { ...args.profile, account_id: account.id },
        });
        const store = await tx.store.create({
          data: { ...args.store, seller_account_id: account.id },
        });
        await this.auditLogs.createAuditLog(
          {
            actorAccountId: args.actorAccountId,
            storeId: store.id,
            targetType: AuditTargetType.ACCOUNT,
            targetId: account.id,
            action: AuditActionType.CREATE,
            afterJson: {
              accountType: 'SELLER',
              username: args.username,
              storeId: store.id.toString(),
            },
          },
          tx,
        );
        return tx.account.findFirstOrThrow({
          where: { id: account.id },
          include: sellerAccountInclude,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(USERNAME_TAKEN);
      }
      throw error;
    }
  }

  /** 비밀번호 교체 + 변경 강제 + 전 세션 폐기 + 감사 기록을 한 트랜잭션으로. */
  async resetCredentialPassword(args: {
    accountId: bigint;
    passwordHash: string;
    audit: AuditEntry;
  }): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.accountCredential.update({
        where: { account_id: args.accountId },
        data: {
          password_hash: args.passwordHash,
          password_updated_at: now,
          must_change_password: true,
          updated_at: now,
        },
      });
      await tx.authRefreshSession.updateMany({
        where: { account_id: args.accountId, revoked_at: null },
        data: { revoked_at: now, updated_at: now },
      });
      await this.auditLogs.createAuditLog(args.audit, tx);
    });
  }

  // ── 구매자 계정 ──

  private userFilterWhere(filter: {
    keyword?: string;
    status?: AccountStatus;
  }): Prisma.AccountWhereInput {
    return {
      account_type: AccountType.USER,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.keyword
        ? {
            OR: [
              { email: { contains: filter.keyword } },
              { name: { contains: filter.keyword } },
              {
                user_profile: {
                  ...activeWhere,
                  nickname: { contains: filter.keyword },
                },
              },
            ],
          }
        : {}),
    };
  }

  async listUserAccounts(args: {
    keyword?: string;
    status?: AccountStatus;
    limit: number;
    cursor?: bigint;
  }): Promise<AdminUserRow[]> {
    return this.prisma.account.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.userFilterWhere(args),
      },
      include: userAccountInclude,
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countUserAccounts(filter: {
    keyword?: string;
    status?: AccountStatus;
  }): Promise<number> {
    return this.prisma.account.count({ where: this.userFilterWhere(filter) });
  }

  async findUserAccountById(accountId: bigint): Promise<AdminUserRow | null> {
    return this.prisma.account.findFirst({
      where: { id: accountId, account_type: AccountType.USER },
      include: userAccountInclude,
    });
  }

  // ── 계정 상태 ──

  async findAccountForStatusChange(accountId: bigint) {
    return this.prisma.account.findFirst({
      where: { id: accountId },
      select: {
        id: true,
        account_type: true,
        status: true,
        store: { select: { id: true } },
      },
    });
  }

  /**
   * 상태 변경 + (정지 시) 세션 폐기 + 감사 기록을 한 트랜잭션으로.
   * 갱신은 기대한 출발 상태(from)일 때만 적용한다 — 두 관리자가 동시에 정지하면 서비스의 사전
   * 검사는 둘 다 통과하므로, 여기서 조건부 갱신으로 하나만 커밋·감사되게 한다.
   * @returns changed=false면 이미 목표 상태였다(멱등, 감사 없음)
   */
  async updateAccountStatus(args: {
    accountId: bigint;
    from: AccountStatus;
    to: AccountStatus;
    revokeSessions: boolean;
    audit: AuditEntry;
    /** from도 to도 아닌 상태로 바뀌어 있을 때 던질 메시지 */
    invalidTransitionMessage: string;
  }): Promise<{ changed: boolean }> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.account.updateMany({
        where: { id: args.accountId, status: args.from, ...activeWhere },
        data: { status: args.to, updated_at: now },
      });
      if (updated.count === 0) {
        const current = await tx.account.findFirst({
          where: { id: args.accountId },
          select: { status: true },
        });
        if (current?.status === args.to) return { changed: false };
        throw new BadRequestException(args.invalidTransitionMessage);
      }
      if (args.revokeSessions) {
        await tx.authRefreshSession.updateMany({
          where: { account_id: args.accountId, revoked_at: null },
          data: { revoked_at: now, updated_at: now },
        });
      }
      await this.auditLogs.createAuditLog(args.audit, tx);
      return { changed: true };
    });
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

  /** 잠금 → 트랜잭션 안에서 before 읽기 → 갱신 → 감사. 없거나 삭제됐으면 null. */
  async updateStore(
    args: { storeId: bigint; data: Prisma.StoreUpdateInput },
    audit: (before: Store, after: Store) => AuditEntry,
  ): Promise<Store | null> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveRow(tx, 'store', args.storeId))) return null;
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

  /** 잠금 → 트랜잭션 안에서 before 읽기 → 갱신 → 감사. 없거나 삭제됐으면 null. */
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

  /** 잠금 → soft-delete + 상품 연결 soft-delete → 감사. 없거나 이미 삭제됐으면 false. */
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

  /** 잠금 → 트랜잭션 안에서 before 읽기 → 갱신 → 감사. 없거나 삭제됐으면 null. */
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

  /** 잠금 → soft-delete + 상품 연결 soft-delete → 감사. 없거나 이미 삭제됐으면 false. */
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

  private reviewReportFilterWhere(filter: {
    status: 'PENDING' | 'RESOLVED' | 'REJECTED' | null;
    targetType?: 'REVIEW' | 'REVIEW_COMMENT';
  }): Prisma.ReviewReportWhereInput {
    return {
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
      where: { id: reportId },
      include: reviewReportDetailInclude,
    });
  }

  /**
   * 신고 처리. 잠금 뒤 트랜잭션 안에서 상태를 보고 PENDING이 아니면 'already-resolved'.
   * DELETE_TARGET은 대상 soft-delete(리뷰는 사진·댓글까지) + 같은 대상의 미처리 신고 전부 RESOLVED,
   * REJECT는 이 건만 REJECTED. 감사는 신고(STATUS_CHANGE)와 대상 삭제(DELETE) 각각.
   */
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
    const target = peek.review_comment_id
      ? { kind: 'review_comment' as const, id: peek.review_comment_id }
      : { kind: 'review' as const, id: peek.review_id! };

    return this.prisma.$transaction(async (tx) => {
      // 잠금 순서: (부모 리뷰 →) 대상(리뷰/댓글) → 신고. 강제 삭제 경로도 같은 순서라, 같은 대상의
      // 다른 신고를 동시에 처리하는 두 트랜잭션이 서로의 잠금을 기다리는 교착이 생기지 않는다.
      // 대상이 이미 삭제됐으면 잠기지 않지만 신고 처리는 계속돼야 한다
      if (target.kind === 'review_comment') {
        await this.lockParentReviewOfComment(tx, target.id);
      }
      await this.lockActiveRow(tx, target.kind, target.id);

      if (!(await this.lockActiveRow(tx, 'review_report', args.reportId))) {
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

  /** 리뷰 강제 삭제. 잠금 → 사진·댓글 cascade → 미처리 신고 RESOLVED → 감사. 없거나 삭제됐으면 false. */
  async adminSoftDeleteReview(args: {
    reviewId: bigint;
    reason: string;
    actorAccountId: bigint;
  }): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockActiveRow(tx, 'review', args.reviewId)))
        return false;
      await this.softDeleteTargetTx(
        tx,
        { kind: 'review', id: args.reviewId },
        now,
        args.actorAccountId,
        { reportId: null, note: args.reason },
      );
      // 리뷰와 함께 내려간 댓글을 겨냥한 신고도 닫는다(작성자 삭제 경로와 같은 범위)
      await this.resolvePendingReportsTx(
        tx,
        {
          OR: [
            { review_id: args.reviewId },
            { review_comment: { review_id: args.reviewId } },
          ],
        },
        now,
        args.actorAccountId,
        args.reason,
      );
      return true;
    });
  }

  /** 댓글 강제 삭제. 잠금 → soft-delete → 미처리 신고 RESOLVED → 감사. 없거나 삭제됐으면 false. */
  async adminSoftDeleteReviewComment(args: {
    commentId: bigint;
    reason: string;
    actorAccountId: bigint;
  }): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await this.lockParentReviewOfComment(tx, args.commentId);
      if (!(await this.lockActiveRow(tx, 'review_comment', args.commentId))) {
        return false;
      }
      await this.softDeleteTargetTx(
        tx,
        { kind: 'review_comment', id: args.commentId },
        now,
        args.actorAccountId,
        { reportId: null, note: args.reason },
      );
      await this.resolvePendingReportsTx(
        tx,
        { review_comment_id: args.commentId },
        now,
        args.actorAccountId,
        args.reason,
      );
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

  private async resolvePendingReportsTx(
    tx: Prisma.TransactionClient,
    targetWhere: Prisma.ReviewReportWhereInput,
    now: Date,
    actorAccountId: bigint,
    note: string,
  ): Promise<void> {
    await tx.reviewReport.updateMany({
      where: { status: 'PENDING', ...targetWhere },
      data: {
        status: 'RESOLVED',
        resolved_by_account_id: actorAccountId,
        resolved_at: now,
        resolution_note: note,
        updated_at: now,
      },
    });
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
}
