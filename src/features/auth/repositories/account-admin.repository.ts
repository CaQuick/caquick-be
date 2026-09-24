import { Inject, Injectable } from '@nestjs/common';

import { DomainException, type ErrorCode } from '@/common/errors/error-catalog';
import {
  AUDIT_LOG_REPOSITORY,
  type AuditEntry,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  type AccountStatus,
  Prisma,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

export type AdminAccountRow = Prisma.AccountGetPayload<{
  include: typeof adminAccountInclude;
}>;

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

/** 관리자가 다루는 계정(관리자·판매자·구매자)의 조회·생성·상태 변경. 자격증명·세션 write는 identity(auth)에만 있다. */
@Injectable()
export class AccountAdminRepository {
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
        await this.auditLogs.recordAudit(tx, {
          actorAccountId: args.actorAccountId,
          storeId: null,
          targetType: AuditTargetType.ACCOUNT,
          targetId: account.id,
          action: AuditActionType.CREATE,
          afterJson: { accountType: 'ADMIN', username: args.username },
        });
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
        throw new DomainException('USERNAME_TAKEN');
      }
      throw error;
    }
  }

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

  /**
   * username 충돌(P2002)은 도메인 예외로 좁힌다(createAdminAccount와 같은 이유).
   * 매장 행은 같은 tx를 넘겨 호출자(catalog 코드)가 만든다 — identity는 store를 import하지 않고 tx만 조정한다(P1-7).
   */
  async createSellerAccount(
    args: {
      actorAccountId: bigint;
      username: string;
      passwordHash: string;
      email: string | null;
      name: string | null;
      profile: Omit<Prisma.SellerProfileUncheckedCreateInput, 'account_id'>;
    },
    createStore: (
      tx: Prisma.TransactionClient,
      sellerAccountId: bigint,
    ) => Promise<{ id: bigint }>,
  ): Promise<AdminSellerRow> {
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
        const store = await createStore(tx, account.id);
        await this.auditLogs.recordAudit(tx, {
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
        });
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
        throw new DomainException('USERNAME_TAKEN');
      }
      throw error;
    }
  }

  /** 기록한 변경 시각을 돌려준다 — 호출자가 커밋 뒤 같은 시각으로 블랙리스트 cutoff를 등록한다. */
  async resetCredentialPassword(args: {
    accountId: bigint;
    passwordHash: string;
    audit: AuditEntry;
  }): Promise<Date> {
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
      await this.auditLogs.recordAudit(tx, args.audit);
    });
    return now;
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
    invalidTransitionCode: ErrorCode;
  }): Promise<{ changed: boolean; changedAt: Date }> {
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
        if (current?.status === args.to) {
          return { changed: false, changedAt: now };
        }
        throw new DomainException(args.invalidTransitionCode);
      }
      if (args.revokeSessions) {
        await tx.authRefreshSession.updateMany({
          where: { account_id: args.accountId, revoked_at: null },
          data: { revoked_at: now, updated_at: now },
        });
      }
      await this.auditLogs.recordAudit(tx, args.audit);
      return { changed: true, changedAt: now };
    });
  }

  // ── 대시보드·감사 로그 화면용 집계(dashboard feature가 배럴로 소비) ──

  async countAccountsCreatedBetween(
    accountType: AccountType,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.prisma.account.count({
      where: { account_type: accountType, created_at: { gte: from, lte: to } },
    });
  }

  /** 감사 로그 행위자 종류 — AuditLog에 계정 FK가 없어 화면이 id로 한 번에 붙인다. 삭제된 계정도 포함(기록 보존). */
  async findAccountTypesByIds(
    ids: bigint[],
  ): Promise<Map<string, AccountType>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.account.findMany({
      where: { id: { in: ids }, deleted_at: undefined },
      select: { id: true, account_type: true },
    });
    return new Map(rows.map((a) => [a.id.toString(), a.account_type]));
  }
}
