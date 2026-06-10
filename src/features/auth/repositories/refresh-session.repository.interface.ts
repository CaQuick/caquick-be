import type { AuthRefreshSession } from '@prisma/client';

/**
 * RefreshSession Repository 토큰 (Nest DI 주입용).
 *
 * 인터페이스 + 토큰 분리는 단위 테스트에서의 mocking 비용을 낮추고,
 * 향후 캐시/리드 레플리카 어댑터 교체를 깨끗하게 만든다.
 */
export const REFRESH_SESSION_REPOSITORY = Symbol('REFRESH_SESSION_REPOSITORY');

/**
 * RefreshSession Repository 인터페이스.
 *
 * 인증 도메인의 토큰 회전·세션 라이프사이클을 담당한다.
 */
export interface IRefreshSessionRepository {
  /**
   * refresh session을 생성한다(토큰은 hash만 저장).
   *
   * @param args 세션 생성 정보
   */
  createRefreshSession(args: {
    accountId: bigint;
    tokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    expiresAt: Date;
  }): Promise<AuthRefreshSession>;

  /**
   * refresh token hash로 활성(유효/미revoke) 세션을 조회한다.
   *
   * @param tokenHash refresh token hash(sha256 hex)
   */
  findActiveRefreshSessionByHash(
    tokenHash: string,
  ): Promise<AuthRefreshSession | null>;

  /**
   * refresh session을 회전한다.
   *
   * - 기존 세션 revoke
   * - 신규 세션 생성
   * - 기존 세션 replaced_by_session_id 연결
   *
   * @param args 회전 정보
   */
  rotateRefreshSession(args: {
    currentSessionId: bigint;
    accountId: bigint;
    newTokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    newExpiresAt: Date;
  }): Promise<AuthRefreshSession>;

  /**
   * 특정 세션을 revoke 처리한다.
   *
   * @param sessionId 세션 id
   */
  revokeRefreshSession(sessionId: bigint): Promise<AuthRefreshSession>;

  /**
   * 특정 계정의 활성 refresh session을 모두 revoke 처리한다.
   *
   * @param accountId account id
   * @param now 기준 시각
   */
  revokeAllRefreshSessions(accountId: bigint, now: Date): Promise<void>;
}
