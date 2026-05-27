import type { Request, Response } from 'express';

/**
 * Token Service 토큰 (Nest DI 주입용).
 */
export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');

/**
 * 인증 토큰 (access JWT + refresh) 의 발급/회전/검증/쿠키 관리를 담당하는 서비스 인터페이스.
 *
 * AuthService 는 비즈니스 흐름(OIDC 콜백·판매자 로그인·로그아웃 등) 에서 본 서비스를 조립해 사용한다.
 */
export interface ITokenService {
  /**
   * access token 을 서명한다.
   */
  signAccessToken(accountId: bigint): string;

  /**
   * Access Token 만료(초) 를 반환한다.
   */
  getAccessExpiresSeconds(): number;

  /**
   * Refresh session 을 생성하고 access token + refresh 쿠키를 발급한다.
   */
  issueAuthTokens(args: {
    accountId: bigint;
    req: Request;
    res: Response;
  }): Promise<{ accessToken: string }>;

  /**
   * refresh 쿠키를 회전한다.
   *
   * - 쿠키에서 refresh token 추출 → hash → 활성 세션 조회
   * - 새 refresh token 생성 → DB 회전 + 새 쿠키 발급
   * - 새 access token 발급
   *
   * @returns accessToken + accountId (Seller 검증 등 후속 로직에 사용)
   */
  rotateRefresh(
    req: Request,
    res: Response,
  ): Promise<{ accessToken: string; accountId: bigint }>;

  /**
   * sha256 hex 해시.
   *
   * AuthService 의 logout 흐름에서 쿠키의 raw refresh token 을 hash 하여 세션 조회에 사용한다.
   */
  sha256Hex(raw: string): string;

  /**
   * refresh 쿠키를 삭제한다.
   *
   * 도메인/secure/sameSite 옵션을 내부에서 설정한다 (호출자는 res 만 넘김).
   */
  clearRefreshCookie(res: Response): void;
}
