import { Injectable } from '@nestjs/common';

import type {
  ISellerCredentialRepository,
  SellerCredentialWithAccount,
} from '@/features/auth/repositories/seller-credential.repository.interface';
import { PrismaService } from '@/prisma';

/**
 * SellerCredential Repository 구체 구현.
 */
@Injectable()
export class SellerCredentialRepository implements ISellerCredentialRepository {
  /**
   * @param prisma PrismaService
   */
  constructor(private readonly prisma: PrismaService) {}

  async findSellerCredentialByUsername(
    username: string,
  ): Promise<SellerCredentialWithAccount | null> {
    return this.prisma.sellerCredential.findFirst({
      where: { username },
      include: {
        seller_account: {
          select: {
            id: true,
            account_type: true,
            status: true,
            store: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });
  }

  async findSellerCredentialByAccountId(
    accountId: bigint,
  ): Promise<SellerCredentialWithAccount | null> {
    return this.prisma.sellerCredential.findFirst({
      where: {
        seller_account_id: accountId,
      },
      include: {
        seller_account: {
          select: {
            id: true,
            account_type: true,
            status: true,
            store: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });
  }

  async updateSellerLastLogin(
    sellerAccountId: bigint,
    now: Date,
  ): Promise<void> {
    await this.prisma.sellerCredential.update({
      where: { seller_account_id: sellerAccountId },
      data: {
        last_login_at: now,
        updated_at: now,
      },
    });
  }

  async updateSellerPasswordHash(args: {
    sellerAccountId: bigint;
    passwordHash: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.sellerCredential.update({
      where: { seller_account_id: args.sellerAccountId },
      data: {
        password_hash: args.passwordHash,
        password_updated_at: args.now,
        updated_at: args.now,
      },
    });
  }
}
