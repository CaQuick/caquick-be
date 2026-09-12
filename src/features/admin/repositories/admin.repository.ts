import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  type Banner,
  type BannerPlacement,
  type CategoryType,
  Prisma,
} from '@prisma/client';

import { USERNAME_TAKEN } from '@/features/admin/constants/admin-error-messages';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { PrismaService, visibleWhere } from '@/prisma';

/** 조작과 함께 남길 감사 기록 인자. */
export type AuditEntry = Parameters<IAuditLogRepository['createAuditLog']>[0];

/** 관리자 계정 행 + 자격증명 요약. 목록·상세·생성이 같은 모양을 쓴다. */
export type AdminAccountRow = Prisma.AccountGetPayload<{
  include: {
    credential: {
      select: {
        username: true;
        must_change_password: true;
        last_login_at: true;
      };
    };
  };
}>;

const adminAccountInclude = {
  credential: {
    select: {
      username: true,
      must_change_password: true,
      last_login_at: true,
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

  async updateBanner(
    args: { bannerId: bigint; data: Prisma.BannerUpdateInput },
    audit: (row: Banner) => AuditEntry,
  ): Promise<Banner> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.banner.update({
        where: { id: args.bannerId },
        data: args.data,
      });
      await this.auditLogs.createAuditLog(audit(row), tx);
      return row;
    });
  }

  async softDeleteBanner(bannerId: bigint, audit: AuditEntry): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.banner.update({
        where: { id: bannerId },
        data: { deleted_at: new Date() },
      });
      await this.auditLogs.createAuditLog(audit, tx);
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
}
