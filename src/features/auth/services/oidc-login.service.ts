import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { ALLOWED_RETURN_TO_DOMAINS } from '@/features/auth/constants/auth.constants';
import { AuthCookieOptions } from '@/features/auth/helpers/auth-cookie-options.helper';
import { AuthCookie } from '@/features/auth/helpers/auth-cookie.helper';
import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import { OidcClientService } from '@/features/auth/services/oidc-client.service';
import type { IOidcLoginService } from '@/features/auth/services/oidc-login.service.interface';
import {
  TOKEN_SERVICE,
  type ITokenService,
} from '@/features/auth/services/token.service.interface';
import {
  parseOidcProvider,
  type OidcProvider,
} from '@/features/auth/types/oidc-provider.type';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

/**
 * OIDC 로그인 흐름 (start / callback) 전담 서비스.
 *
 * AuthService 의 OIDC 책임 추출 결과물. Token 발급은 TokenService 에 위임한다.
 */
@Injectable()
export class OidcLoginService implements IOidcLoginService {
  /**
   * @param config ConfigService
   * @param oidc OidcClientService
   * @param tokens TokenService
   * @param accounts AccountRepository
   */
  constructor(
    private readonly config: ConfigService,
    private readonly oidc: OidcClientService,
    @Inject(TOKEN_SERVICE)
    private readonly tokens: ITokenService,
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accounts: IAccountRepository,
  ) {}

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
      cookieDomain: AuthCookieOptions.getCookieDomain(this.config),
      secure: AuthCookieOptions.isCookieSecure(this.config),
      sameSite: AuthCookieOptions.getCookieSameSite(this.config),
    });

    return { redirectUrl: authorizationUrl };
  }

  async handleOidcCallback(
    rawProvider: string,
    req: Request,
    res: Response,
  ): Promise<{ returnTo: string; accessToken: string }> {
    const provider = parseOidcProvider(rawProvider);

    const { expectedState, expectedNonce, codeVerifier, returnTo } =
      this.extractOidcTempCookies(req);

    const tokenSet = await this.exchangeOidcCode(
      provider,
      req,
      expectedState,
      expectedNonce,
      codeVerifier,
    );

    const userInfo = this.extractUserInfoFromClaims(tokenSet.claims());

    const account = await this.upsertAccountFromOidc(provider, userInfo);

    const { accessToken } = await this.tokens.issueAuthTokens({
      accountId: account.id,
      req,
      res,
    });

    AuthCookie.clearOidcTempCookies(
      res,
      AuthCookieOptions.getCookieDomain(this.config),
      AuthCookieOptions.isCookieSecure(this.config),
      AuthCookieOptions.getCookieSameSite(this.config),
    );

    return { returnTo, accessToken };
  }

  /**
   * OIDC 임시 쿠키를 추출하고 검증한다.
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
   * OIDC code 를 token 으로 교환한다.
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
   * OIDC claims 에서 사용자 정보를 추출한다.
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

    const { account } = await this.accounts.upsertUserByOidcIdentity({
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
   * returnTo 값을 안전하게 정규화한다 (오픈 리다이렉트 방지).
   */
  private normalizeReturnTo(raw: string | undefined): string {
    const frontend =
      this.config.get<string>('FRONTEND_BASE_URL')?.trim() ??
      'http://localhost:3000';

    if (!raw || raw.trim().length === 0) return frontend;

    const allowed = [frontend, ...ALLOWED_RETURN_TO_DOMAINS];
    const ok = allowed.some((prefix) => raw.startsWith(prefix));
    return ok ? raw : frontend;
  }

  /**
   * callback params (code / state 등) 를 안전하게 추출한다.
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
    pick('iss');
    pick('error');
    pick('error_description');

    return result;
  }

  /**
   * provider 별 callback redirect uri 를 반환한다.
   */
  private getCallbackRedirectUri(provider: OidcProvider): string {
    const backendBase =
      this.config.get<string>('BACKEND_BASE_URL')?.trim() ??
      'http://localhost:4000';

    return `${backendBase}/auth/oidc/${provider}/callback`;
  }
}
