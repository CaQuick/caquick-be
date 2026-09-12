import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  Prisma,
} from '@prisma/client';

import { USERNAME_TAKEN } from '@/features/admin/constants/admin-error-messages';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { PrismaService } from '@/prisma';

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
}
