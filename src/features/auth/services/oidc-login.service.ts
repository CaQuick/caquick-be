import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { DomainException } from '@/common/errors/error-catalog';
import { ALLOWED_RETURN_TO_DOMAINS } from '@/features/auth/constants/auth.constants';
import { AuthCookieOptions } from '@/features/auth/helpers/auth-cookie-options.helper';
import { AuthCookie } from '@/features/auth/helpers/auth-cookie.helper';
import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import { OidcClientService } from '@/features/auth/services/oidc-client.service';
import { TokenService } from '@/features/auth/services/token.service';
import {
  parseOidcProvider,
  type OidcProvider,
} from '@/features/auth/types/oidc-provider.type';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

@Injectable()
export class OidcLoginService {
  constructor(
    private readonly config: ConfigService,
    private readonly oidc: OidcClientService,
    private readonly tokens: TokenService,
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

    const userInfo = this.extractUserInfoFromClaims(
      provider,
      tokenSet.claims(),
    );

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

  private extractOidcTempCookies(req: Request): {
    expectedState: string;
    expectedNonce: string;
    codeVerifier: string;
    returnTo: string;
  } {
    const expectedState = req.cookies?.[AUTH_COOKIE.OIDC_STATE] as
      string | undefined;
    const expectedNonce = req.cookies?.[AUTH_COOKIE.OIDC_NONCE] as
      string | undefined;
    const codeVerifier = req.cookies?.[AUTH_COOKIE.OIDC_CODE_VERIFIER] as
      string | undefined;
    const returnTo =
      (req.cookies?.[AUTH_COOKIE.OIDC_RETURN_TO] as string | undefined) ??
      this.normalizeReturnTo(undefined);

    if (!expectedState || !expectedNonce || !codeVerifier) {
      throw new DomainException('OIDC_SESSION_MISSING');
    }

    return { expectedState, expectedNonce, codeVerifier, returnTo };
  }

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

  private extractUserInfoFromClaims(
    provider: OidcProvider,
    claims: Record<string, unknown>,
  ): {
    subject: string;
    email?: string;
    emailVerified: boolean;
    displayName?: string;
    picture?: string;
  } {
    const subject = typeof claims.sub === 'string' ? claims.sub : null;
    if (!subject) {
      throw new DomainException('OIDC_SUBJECT_MISSING');
    }

    const email = typeof claims.email === 'string' ? claims.email : undefined;
    // 카카오 ID 토큰에는 email_verified 클레임이 아예 없다. 표준대로 검사하면 카카오 계정의
    // account.email 이 영구히 null 로 남는다. `account_email` 동의항목으로 내려오는 값은
    // 카카오가 보유·관리하는 계정 이메일이므로 인증된 것으로 취급한다.
    const emailVerified =
      claims.email_verified === true ||
      (provider === 'kakao' && email !== undefined);

    const displayName =
      (typeof claims.name === 'string' ? claims.name : undefined) ??
      (typeof claims.nickname === 'string' ? claims.nickname : undefined);

    const picture =
      typeof claims.picture === 'string' ? claims.picture : undefined;

    return { subject, email, emailVerified, displayName, picture };
  }

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

    if (!account) {
      throw new DomainException('ACCOUNT_UPSERT_FAILED');
    }

    return account;
  }

  /** 오픈 리다이렉트 방지. */
  private normalizeReturnTo(raw: string | undefined): string {
    const frontend =
      this.config.get<string>('FRONTEND_BASE_URL')?.trim() ??
      'http://localhost:3000';

    if (!raw || raw.trim().length === 0) return frontend;

    const allowed = [frontend, ...ALLOWED_RETURN_TO_DOMAINS];
    const ok = allowed.some((prefix) => raw.startsWith(prefix));
    return ok ? raw : frontend;
  }

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

  private getCallbackRedirectUri(provider: OidcProvider): string {
    const backendBase =
      this.config.get<string>('BACKEND_BASE_URL')?.trim() ??
      'http://localhost:4000';

    return `${backendBase}/auth/oidc/${provider}/callback`;
  }
}
