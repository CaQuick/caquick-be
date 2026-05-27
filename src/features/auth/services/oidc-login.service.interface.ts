import type { Request, Response } from 'express';

/**
 * OidcLoginService 토큰 (Nest DI 주입용).
 */
export const OIDC_LOGIN_SERVICE = Symbol('OIDC_LOGIN_SERVICE');

/**
 * OIDC 로그인 흐름 (start / callback) 을 담당하는 서비스 인터페이스.
 *
 * AuthController 가 이를 직접 호출한다. AuthService 와는 동등한 도메인 서비스 레이어.
 */
export interface IOidcLoginService {
  /**
   * OIDC 로그인 시작:
   * - 인가 URL 생성
   * - state / nonce / codeVerifier / returnTo 를 임시 쿠키로 세팅
   *
   * @param rawProvider provider param (검증되지 않은 raw 문자열)
   * @param returnTo 로그인 완료 후 FE 리다이렉트 목적지 (옵션)
   * @param res Response
   */
  startOidcLogin(
    rawProvider: string,
    returnTo: string | undefined,
    res: Response,
  ): Promise<{ redirectUrl: string }>;

  /**
   * OIDC 콜백 처리:
   * - state / nonce 검증
   * - code → token 교환
   * - Account / Identity upsert
   * - refresh 쿠키 발급 + access token 반환
   * - OIDC 임시 쿠키 삭제
   *
   * @param rawProvider provider param
   * @param req Request
   * @param res Response
   */
  handleOidcCallback(
    rawProvider: string,
    req: Request,
    res: Response,
  ): Promise<{ returnTo: string; accessToken: string }>;
}
