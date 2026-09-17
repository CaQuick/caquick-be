import { Injectable } from '@nestjs/common';

import type {
  AccountCredentialWithAccount,
  IAccountCredentialRepository,
} from '@/features/auth/repositories/account-credential.repository.interface';
import { PrismaService } from '@/prisma';

@Injectable()
export class AccountCredentialRepository implements IAccountCredentialRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  async updatePasswordHash(args: {
    accountId: bigint;
    passwordHash: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.accountCredential.update({
      where: { account_id: args.accountId },
      data: {
        password_hash: args.passwordHash,
        password_updated_at: args.now,
        must_change_password: false,
        updated_at: args.now,
      },
    });
  }
}
