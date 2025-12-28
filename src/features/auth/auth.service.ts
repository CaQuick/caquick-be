import { createHash, randomBytes } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';

import {
  getEnvAsBoolean,
  getEnvAsNumber,
} from '../../common/helpers/config.helper';
import { AUTH_COOKIE } from '../../global/auth/constants/auth-cookie.constants';
import type { AccessTokenPayload } from '../../global/auth/types/jwt-payload.type';

import { ALLOWED_RETURN_TO_DOMAINS } from './constants/auth.constants';
import { AuthCookie } from './helpers/auth-cookie.helper';
import { AuthRepository } from './repositories/auth.repository';
import { OidcClientService } from './services/oidc-client.service';
import {
  parseOidcProvider,
  type OidcProvider,
} from './types/oidc-provider.type';

/**
 * 인증/로그인/토큰 발급/갱신 비즈니스 로직
 */
@Injectable()
export class AuthService {
  /**
   * @param config ConfigService
   * @param jwt JwtService
   * @param oidc OidcClientService
   * @param repo AuthRepository
   */
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly oidc: OidcClientService,
    private readonly repo: AuthRepository,
  ) {}

  /**
   * OIDC 로그인 시작(리다이렉트 URL 생성 + 임시 쿠키 세팅)
   *
   * @param rawProvider provider param
   * @param returnTo FE 리다이렉트 목적지
   * @param res Response
   */
  async startOidcLogin(
    rawProvider: string,
    returnTo: string | undefined,
    res: Response,
  ): Promise<{ redirectUrl: string }> {
    const provider = parseOidcProvider(rawProvider);
    const safeReturnTo = this.normalizeReturnTo(returnTo);

    const { authorizationUrl, state, nonce, codeVerifier } =
      await this.oidc.buildAuthorizationUrl(provider);

    AuthCookie.setOidcTempCookies(res, {
      state,
      nonce,
      codeVerifier,
      returnTo: safeReturnTo,
      cookieDomain: this.getCookieDomain(),
      secure: this.isCookieSecure(),
    });

    return { redirectUrl: authorizationUrl };
  }

  /**
   * OIDC 콜백 처리:
   * - state/nonce 검증
   * - code 교환
   * - Account/Identity upsert
   * - access/refresh 쿠키 발급
   *
   * @param rawProvider provider param
   * @param req Request
   * @param res Response
   */
  async handleOidcCallback(
    rawProvider: string,
    req: Request,
    res: Response,
  ): Promise<{ returnTo: string }> {
    const provider = parseOidcProvider(rawProvider);

    // 1. OIDC 임시 쿠키 검증 및 추출
    const { expectedState, expectedNonce, codeVerifier, returnTo } =
      this.extractOidcTempCookies(req);

    // 2. code를 token으로 교환
    const tokenSet = await this.exchangeOidcCode(
      provider,
      req,
      expectedState,
      expectedNonce,
      codeVerifier,
    );

    // 3. claims에서 사용자 정보 추출
    const userInfo = this.extractUserInfoFromClaims(tokenSet.claims());

    // 4. 계정 생성/업데이트
    const account = await this.upsertAccountFromOidc(provider, userInfo);

    // 5. 인증 쿠키 발급
    await this.issueAuthCookies({
      accountId: account.id,
      req,
      res,
    });

    // 6. OIDC 임시 쿠키 삭제
    AuthCookie.clearOidcTempCookies(
      res,
      this.getCookieDomain(),
      this.isCookieSecure(),
    );

    return { returnTo };
  }

  /**
   * Refresh 토큰으로 access/refresh를 재발급한다(회전).
   *
   * @param req Request
   * @param res Response
   */
  async refresh(req: Request, res: Response): Promise<void> {
    const refreshToken = req.cookies?.[AUTH_COOKIE.REFRESH] as
      | string
      | undefined;

    if (!refreshToken)
      throw new UnauthorizedException('Missing refresh token.');

    const tokenHash = this.sha256Hex(refreshToken);
    const session = await this.repo.findActiveRefreshSessionByHash(tokenHash);

    if (!session) throw new UnauthorizedException('Invalid refresh token.');

    const newRefreshToken = this.generateRefreshToken();
    const newTokenHash = this.sha256Hex(newRefreshToken);

    const refreshDays = this.getRefreshDays();
    const newExpiresAt = new Date(Date.now() + refreshDays * 86400 * 1000);

    await this.repo.rotateRefreshSession({
      currentSessionId: session.id,
      accountId: session.account_id,
      newTokenHash,
      userAgent: this.getUserAgent(req),
      ipAddress: this.getIp(req),
      newExpiresAt,
    });

    const accessToken = this.signAccessToken(session.account_id);

    AuthCookie.setAuthCookies(res, {
      accessToken,
      refreshToken: newRefreshToken,
      accessMaxAgeMs: this.getAccessExpiresSeconds() * 1000,
      refreshMaxAgeMs: refreshDays * 86400 * 1000,
      cookieDomain: this.getCookieDomain(),
      secure: this.isCookieSecure(),
    });
  }

  /**
   * 로그아웃:
   * - refresh 세션 revoke
   * - 쿠키 삭제
   *
   * @param req Request
   * @param res Response
   */
  async logout(req: Request, res: Response): Promise<void> {
    const refreshToken = req.cookies?.[AUTH_COOKIE.REFRESH] as
      | string
      | undefined;

    if (refreshToken) {
      const tokenHash = this.sha256Hex(refreshToken);
      const session = await this.repo.findActiveRefreshSessionByHash(tokenHash);
      if (session) await this.repo.revokeRefreshSession(session.id);
    }

    AuthCookie.clearAuthCookies(
      res,
      this.getCookieDomain(),
      this.isCookieSecure(),
    );
  }

  /**
   * 현재 로그인 사용자 정보를 반환한다.
   *
   * @param accountId accountId(BigInt)
   */
  async me(accountId: bigint) {
    const account = await this.repo.findAccountForMe(accountId);
    if (!account) throw new UnauthorizedException('Account not found.');

    const profile = account.user_profile;

    const needsProfile =
      !profile?.birth_date || !profile?.phone_number || !profile?.nickname;

    return {
      accountId: account.id.toString(),
      email: account.email,
      name: account.name,
      nickname: profile?.nickname ?? null,
      profileImageUrl: profile?.profile_image_url ?? null,
      birthDate: profile?.birth_date
        ? profile.birth_date.toISOString().slice(0, 10)
        : null,
      phoneNumber: profile?.phone_number ?? null,
      needsProfile,
    };
  }

  /**
   * OIDC 임시 쿠키를 추출하고 검증한다.
   *
   * @param req Request
   */
  private extractOidcTempCookies(req: Request): {
    expectedState: string;
    expectedNonce: string;
    codeVerifier: string;
    returnTo: string;
  } {
    const expectedState = req.cookies?.[AUTH_COOKIE.OIDC_STATE] as
      | string
      | undefined;
    const expectedNonce = req.cookies?.[AUTH_COOKIE.OIDC_NONCE] as
      | string
      | undefined;
    const codeVerifier = req.cookies?.[AUTH_COOKIE.OIDC_CODE_VERIFIER] as
      | string
      | undefined;
    const returnTo =
      (req.cookies?.[AUTH_COOKIE.OIDC_RETURN_TO] as string | undefined) ??
      this.normalizeReturnTo(undefined);

    if (!expectedState || !expectedNonce || !codeVerifier) {
      throw new UnauthorizedException('OIDC session is missing.');
    }

    return { expectedState, expectedNonce, codeVerifier, returnTo };
  }

  /**
   * OIDC code를 token으로 교환한다.
   *
   * @param provider provider
   * @param req Request
   * @param expectedState state
   * @param expectedNonce nonce
   * @param codeVerifier code verifier
   */
  private async exchangeOidcCode(
    provider: OidcProvider,
    req: Request,
    expectedState: string,
    expectedNonce: string,
    codeVerifier: string,
  ) {
    const callbackParams = this.pickCallbackParams(req);
    const redirectUri = this.getCallbackRedirectUri(provider);

    return this.oidc.exchangeCode(provider, {
      redirectUri,
      callbackParams,
      state: expectedState,
      nonce: expectedNonce,
      codeVerifier,
    });
  }

  /**
   * OIDC claims에서 사용자 정보를 추출한다.
   *
   * @param claims OIDC claims
   */
  private extractUserInfoFromClaims(claims: Record<string, unknown>): {
    subject: string;
    email?: string;
    emailVerified: boolean;
    displayName?: string;
    picture?: string;
  } {
    const subject = typeof claims.sub === 'string' ? claims.sub : null;
    if (!subject) throw new UnauthorizedException('OIDC subject is missing.');

    const email = typeof claims.email === 'string' ? claims.email : undefined;
    const emailVerified = claims.email_verified === true;

    const displayName =
      (typeof claims.name === 'string' ? claims.name : undefined) ??
      (typeof claims.nickname === 'string' ? claims.nickname : undefined);

    const picture =
      typeof claims.picture === 'string' ? claims.picture : undefined;

    return { subject, email, emailVerified, displayName, picture };
  }

  /**
   * OIDC 사용자 정보로 계정을 생성/업데이트한다.
   *
   * @param provider provider
   * @param userInfo 사용자 정보
   */
  private async upsertAccountFromOidc(
    provider: OidcProvider,
    userInfo: {
      subject: string;
      email?: string;
      emailVerified: boolean;
      displayName?: string;
      picture?: string;
    },
  ) {
    const identityProvider = this.oidc.toIdentityProvider(provider);

    const { account } = await this.repo.upsertUserByOidcIdentity({
      provider: identityProvider,
      providerSubject: userInfo.subject,
      providerEmail: userInfo.email,
      emailVerified: userInfo.emailVerified,
      providerDisplayName: userInfo.displayName,
      providerProfileImageUrl: userInfo.picture,
    });

    if (!account) throw new UnauthorizedException('Account upsert failed.');

    return account;
  }

  /**
   * returnTo 값을 안전하게 정규화한다(오픈리다이렉트 방지).
   *
   * @param raw returnTo
   */
  private normalizeReturnTo(raw: string | undefined): string {
    const frontend =
      this.config.get<string>('FRONTEND_BASE_URL')?.trim() ??
      'http://localhost:3000';

    if (!raw || raw.trim().length === 0) return frontend;

    // 같은 site로만 허용(정확히는 prefix 기반)
    const allowed = [frontend, ...ALLOWED_RETURN_TO_DOMAINS];
    const ok = allowed.some((prefix) => raw.startsWith(prefix));
    return ok ? raw : frontend;
  }

  /**
   * callback params(code/state 등)를 안전하게 추출한다.
   *
   * @param req Request
   */
  private pickCallbackParams(req: Request): Record<string, string | string[]> {
    const q = req.query as Record<string, unknown>;
    const result: Record<string, string | string[]> = {};

    const isStringArray = (val: unknown): val is string[] =>
      Array.isArray(val) && val.every((x) => typeof x === 'string');

    const pick = (key: string): void => {
      const v = q[key];

      if (typeof v === 'string') {
        result[key] = v;
        return;
      }

      if (isStringArray(v)) {
        result[key] = v;
      }
    };

    pick('code');
    pick('state');
    pick('error');
    pick('error_description');

    return result;
  }

  /**
   * provider별 callback redirect uri를 반환한다.
   *
   * @param provider provider
   */
  private getCallbackRedirectUri(provider: OidcProvider): string {
    const backendBase =
      this.config.get<string>('BACKEND_BASE_URL')?.trim() ??
      'http://localhost:4000';

    return `${backendBase}/auth/oidc/${provider}/callback`;
  }

  /**
   * access token을 서명한다.
   *
   * @param accountId account id
   */
  private signAccessToken(accountId: bigint): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.getAccessExpiresSeconds();

    const payload: AccessTokenPayload = {
      sub: accountId.toString(),
      typ: 'access',
      iat: now,
      exp,
    };

    return this.jwt.sign(payload);
  }

  /**
   * access/refresh 쿠키를 발급하고 refresh 세션을 저장한다.
   *
   * @param args 발급 파라미터
   */
  private async issueAuthCookies(args: {
    accountId: bigint;
    req: Request;
    res: Response;
  }): Promise<void> {
    const accessToken = this.signAccessToken(args.accountId);

    const refreshToken = this.generateRefreshToken();
    const refreshHash = this.sha256Hex(refreshToken);

    const refreshDays = this.getRefreshDays();
    const expiresAt = new Date(Date.now() + refreshDays * 86400 * 1000);

    await this.repo.createRefreshSession({
      accountId: args.accountId,
      tokenHash: refreshHash,
      userAgent: this.getUserAgent(args.req),
      ipAddress: this.getIp(args.req),
      expiresAt,
    });

    AuthCookie.setAuthCookies(args.res, {
      accessToken,
      refreshToken,
      accessMaxAgeMs: this.getAccessExpiresSeconds() * 1000,
      refreshMaxAgeMs: refreshDays * 86400 * 1000,
      cookieDomain: this.getCookieDomain(),
      secure: this.isCookieSecure(),
    });
  }

  /**
   * refresh token 랜덤 문자열을 생성한다.
   */
  private generateRefreshToken(): string {
    // 32 bytes -> 64 hex
    return randomBytes(32).toString('hex');
  }

  /**
   * sha256 hex를 만든다.
   *
   * @param raw raw string
   */
  private sha256Hex(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Access Token 만료(초)를 반환한다.
   */
  private getAccessExpiresSeconds(): number {
    return getEnvAsNumber(this.config, 'JWT_ACCESS_EXPIRES_SECONDS', 900);
  }

  /**
   * Refresh 만료(일)를 반환한다.
   */
  private getRefreshDays(): number {
    return getEnvAsNumber(this.config, 'AUTH_REFRESH_EXPIRES_DAYS', 30);
  }

  /**
   * 쿠키 도메인을 반환한다.
   */
  private getCookieDomain(): string | undefined {
    const v = this.config.get<string>('AUTH_COOKIE_DOMAIN');
    const trimmed = v?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * 쿠키 secure 옵션을 반환한다.
   */
  private isCookieSecure(): boolean {
    const envValue = this.config.get<string>('AUTH_COOKIE_SECURE');
    if (envValue !== undefined) {
      return getEnvAsBoolean(this.config, 'AUTH_COOKIE_SECURE', false);
    }
    // 기본값: production이면 true
    return (this.config.get<string>('NODE_ENV') ?? '') === 'production';
  }

  /**
   * Request에서 user-agent를 추출한다.
   *
   * @param req Request
   */
  private getUserAgent(req: Request): string | undefined {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua.slice(0, 512) : undefined;
  }

  /**
   * Request에서 IP를 추출한다.
   *
   * @param req Request
   */
  private getIp(req: Request): string | undefined {
    return typeof req.ip === 'string' ? req.ip : undefined;
  }
}
