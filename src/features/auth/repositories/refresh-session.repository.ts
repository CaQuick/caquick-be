import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import type { IRefreshSessionRepository } from '@/features/auth/repositories/refresh-session.repository.interface';
import type { AuthRefreshSession, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/**
 * RefreshSession Repository 구체 구현.
 *
 * Prisma 의 `authRefreshSession` 테이블을 직접 다룬다.
 */
@Injectable()
export class RefreshSessionRepository implements IRefreshSessionRepository {
  /**
   * @param prisma PrismaService
   * @param clock ClockService
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async createRefreshSession(args: {
    accountId: bigint;
    tokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    expiresAt: Date;
  }): Promise<AuthRefreshSession> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAccountActiveForUpdate(tx, args.accountId);
      return tx.authRefreshSession.create({
        data: {
          account_id: args.accountId,
          token_hash: args.tokenHash,
          user_agent: args.userAgent ?? null,
          ip_address: args.ipAddress ?? null,
          expires_at: args.expiresAt,
        },
      });
    });
  }

  /**
   * 세션 발급·회전은 ACTIVE 계정에만. 계정 행을 잠그고(FOR UPDATE) 확인해, 관리자 정지
   * 트랜잭션(status 갱신 + 전 세션 폐기)과 교차해도 정지된 계정에 새 세션이 남지 않게 한다 —
   * 잠금을 기다린 쪽은 갱신된 status를 보고 실패한다.
   */
  private async assertAccountActiveForUpdate(
    tx: Prisma.TransactionClient,
    accountId: bigint,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM account
      WHERE id = ${accountId} AND deleted_at IS NULL
      FOR UPDATE`;
    if (rows[0]?.status !== 'ACTIVE') {
      throw new DomainException('ACCOUNT_NOT_ACTIVE');
    }
  }

  async findActiveRefreshSessionByHash(
    tokenHash: string,
  ): Promise<AuthRefreshSession | null> {
    const now = this.clock.now();
    return this.prisma.authRefreshSession.findFirst({
      where: {
        token_hash: tokenHash,
        revoked_at: null,
        expires_at: { gt: now },
      },
    });
  }

  async rotateRefreshSession(args: {
    currentSessionId: bigint;
    accountId: bigint;
    newTokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    newExpiresAt: Date;
  }): Promise<AuthRefreshSession> {
    return this.prisma.$transaction(async (tx) => {
      const now = this.clock.now();
      await this.assertAccountActiveForUpdate(tx, args.accountId);

      const newSession = await tx.authRefreshSession.create({
        data: {
          account_id: args.accountId,
          token_hash: args.newTokenHash,
          user_agent: args.userAgent ?? null,
          ip_address: args.ipAddress ?? null,
          expires_at: args.newExpiresAt,
        },
      });

      await tx.authRefreshSession.update({
        where: { id: args.currentSessionId },
        data: {
          revoked_at: now,
          replaced_by_session_id: newSession.id,
          updated_at: now,
        },
      });

      return newSession;
    });
  }

  async revokeRefreshSession(sessionId: bigint): Promise<AuthRefreshSession> {
    const now = this.clock.now();
    return this.prisma.authRefreshSession.update({
      where: { id: sessionId },
      data: { revoked_at: now, updated_at: now },
    });
  }

  async revokeAllRefreshSessions(accountId: bigint, now: Date): Promise<void> {
    await this.prisma.authRefreshSession.updateMany({
      where: {
        account_id: accountId,
        revoked_at: null,
      },
      data: {
        revoked_at: now,
        updated_at: now,
      },
    });
  }
}
