import type { AuthRefreshSession } from '@/generated/prisma/client';

/** 인터페이스 + 토큰 분리는 캐시/리드 레플리카 어댑터 교체를 위한 것. */
export const REFRESH_SESSION_REPOSITORY = Symbol('REFRESH_SESSION_REPOSITORY');

export interface IRefreshSessionRepository {
  /** 토큰은 hash만 저장한다. */
  createRefreshSession(args: {
    accountId: bigint;
    tokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    expiresAt: Date;
  }): Promise<AuthRefreshSession>;

  findActiveRefreshSessionByHash(
    tokenHash: string,
  ): Promise<AuthRefreshSession | null>;

  rotateRefreshSession(args: {
    currentSessionId: bigint;
    accountId: bigint;
    newTokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    newExpiresAt: Date;
  }): Promise<AuthRefreshSession>;

  revokeRefreshSession(sessionId: bigint): Promise<AuthRefreshSession>;

  revokeAllRefreshSessions(accountId: bigint, now: Date): Promise<void>;
}
