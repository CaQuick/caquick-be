import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditEntry,
  type IAuditLogRepository,
} from '@/features/audit-log';
import type {
  AccountCredentialWithAccount,
  IAccountCredentialRepository,
} from '@/features/auth/repositories/account-credential.repository.interface';
import { PrismaService } from '@/prisma';

@Injectable()
export class AccountCredentialRepository implements IAccountCredentialRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  private readonly accountInclude = {
    account: {
      select: {
        id: true,
        account_type: true,
        status: true,
        store: { select: { id: true } },
      },
    },
  } as const;

  async findCredentialByUsername(
    username: string,
  ): Promise<AccountCredentialWithAccount | null> {
    return this.prisma.accountCredential.findFirst({
      where: { username },
      include: this.accountInclude,
    });
  }

  async findCredentialByAccountId(
    accountId: bigint,
  ): Promise<AccountCredentialWithAccount | null> {
    return this.prisma.accountCredential.findFirst({
      where: { account_id: accountId },
      include: this.accountInclude,
    });
  }

  async updateLastLogin(accountId: bigint, now: Date): Promise<void> {
    await this.prisma.accountCredential.update({
      where: { account_id: accountId },
      data: {
        last_login_at: now,
        updated_at: now,
      },
    });
  }

  /**
   * 비밀번호 교체·전 세션 무효화·감사 기록을 한 트랜잭션으로 한다(P1-12) — 셋 중 하나만 커밋되면
   * "바꿨는데 옛 세션이 살아 있다"거나 "바꿨는데 기록이 없다"가 된다.
   */
  async changePassword(
    args: {
      accountId: bigint;
      passwordHash: string;
      now: Date;
    },
    audit: () => AuditEntry,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.accountCredential.update({
        where: { account_id: args.accountId },
        data: {
          password_hash: args.passwordHash,
          password_updated_at: args.now,
          must_change_password: false,
          updated_at: args.now,
        },
      });
      await tx.authRefreshSession.updateMany({
        where: { account_id: args.accountId, revoked_at: null },
        data: { revoked_at: args.now, updated_at: args.now },
      });
      await this.auditLogs.recordAudit(tx, audit());
    });
  }
}
