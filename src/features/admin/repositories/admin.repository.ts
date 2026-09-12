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
  type Store,
} from '@prisma/client';

import { USERNAME_TAKEN } from '@/features/admin/constants/admin-error-messages';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

/** 행 잠금 대상 테이블. 고정 문자열만 raw로 들어간다. */
type LockableTable = 'store' | 'product' | 'banner' | 'category' | 'tag';

/** 조작과 함께 남길 감사 기록 인자. */
export type AuditEntry = Parameters<IAuditLogRepository['createAuditLog']>[0];

/** 관리자 계정 행 + 자격증명 요약. 목록·상세·생성이 같은 모양을 쓴다. */
export type AdminAccountRow = Prisma.AccountGetPayload<{
  include: typeof adminAccountInclude;
}>;

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
      ...(filter.storeId ? { store_id: filter.storeId } : {}),
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

  /** 노출 토글 + 감사 기록을 한 트랜잭션으로. */
  async setProductActive(
    args: { productId: bigint; isActive: boolean },
    audit: (row: AdminProductRow) => AuditEntry,
  ): Promise<AdminProductRow> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.product.update({
        where: { id: args.productId },
        data: { is_active: args.isActive },
        include: productInclude,
      });
      await this.auditLogs.createAuditLog(audit(row), tx);
      return row;
    });
  }
}
