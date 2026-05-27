import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  type AccountStatus,
} from '@prisma/client';
import argon2 from 'argon2';
import type { Request, Response } from 'express';

import { ClockService } from '@/common/providers/clock.service';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { ALLOWED_RETURN_TO_DOMAINS } from '@/features/auth/constants/auth.constants';
import { AuthCookieOptions } from '@/features/auth/helpers/auth-cookie-options.helper';
import { AuthCookie } from '@/features/auth/helpers/auth-cookie.helper';
import {
  getIp,
  getUserAgent,
} from '@/features/auth/helpers/auth-request-meta.helper';
import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import {
  SELLER_CREDENTIAL_REPOSITORY,
  type ISellerCredentialRepository,
} from '@/features/auth/repositories/seller-credential.repository.interface';
import { OidcClientService } from '@/features/auth/services/oidc-client.service';
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
 * 인증/로그인/토큰 발급/갱신 비즈니스 로직
 */
@Injectable()
export class AuthService {
  /**
   * @param config ConfigService
   * @param oidc OidcClientService
   * @param tokens TokenService
   * @param accounts AccountRepository
   * @param sellerCredentials SellerCredentialRepository
   * @param refreshSessions RefreshSessionRepository
   * @param auditLogs AuditLogRepository
   * @param clock ClockService
   */
  constructor(
    private readonly config: ConfigService,
    private readonly oidc: OidcClientService,
    @Inject(TOKEN_SERVICE)
    private readonly tokens: ITokenService,
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accounts: IAccountRepository,
    @Inject(SELLER_CREDENTIAL_REPOSITORY)
    private readonly sellerCredentials: ISellerCredentialRepository,
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessions: IRefreshSessionRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
    private readonly clock: ClockService,
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
      cookieDomain: AuthCookieOptions.getCookieDomain(this.config),
      secure: AuthCookieOptions.isCookieSecure(this.config),
      sameSite: AuthCookieOptions.getCookieSameSite(this.config),
    });

    return { redirectUrl: authorizationUrl };
  }

  /**
   * OIDC 콜백 처리:
   * - state/nonce 검증
   * - code 교환
   * - Account/Identity upsert
   * - refresh 쿠키 발급 및 access token 반환
   *
   * @param rawProvider provider param
   * @param req Request
   * @param res Response
   */
  async handleOidcCallback(
    rawProvider: string,
    req: Request,
    res: Response,
  ): Promise<{ returnTo: string; accessToken: string }> {
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

    // 5. refresh 쿠키 발급 + access token 생성
    const { accessToken } = await this.tokens.issueAuthTokens({
      accountId: account.id,
      req,
      res,
    });

    // 6. OIDC 임시 쿠키 삭제
    AuthCookie.clearOidcTempCookies(
      res,
      AuthCookieOptions.getCookieDomain(this.config),
      AuthCookieOptions.isCookieSecure(this.config),
      AuthCookieOptions.getCookieSameSite(this.config),
    );

    return { returnTo, accessToken };
  }

  /**
   * 판매자 username/password 로그인
   *
   * @param username 판매자 username
   * @param password 판매자 password
   * @param req Request
   * @param res Response
   */
  async sellerLogin(args: {
    username: string;
    password: string;
    req: Request;
    res: Response;
  }): Promise<{ accessToken: string; accountStatus: AccountStatus }> {
    const username = args.username.trim();
    const password = args.password;

    if (!username || !password.trim()) {
      throw new UnauthorizedException('Invalid seller credentials.');
    }

    const credential =
      await this.sellerCredentials.findSellerCredentialByUsername(username);
    if (!credential)
      throw new UnauthorizedException('Invalid seller credentials.');

    if (credential.seller_account.account_type !== AccountType.SELLER) {
      throw new UnauthorizedException('Invalid seller credentials.');
    }

    const isPasswordValid = await argon2.verify(
      credential.password_hash,
      password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid seller credentials.');
    }

    const now = this.clock.now();
    await this.sellerCredentials.updateSellerLastLogin(
      credential.seller_account_id,
      now,
    );

    const { accessToken } = await this.tokens.issueAuthTokens({
      accountId: credential.seller_account_id,
      req: args.req,
      res: args.res,
    });

    return {
      accessToken,
      accountStatus: credential.seller_account.status,
    };
  }

  /**
   * Refresh 토큰으로 access를 재발급하고 refresh를 회전한다.
   *
   * @param req Request
   * @param res Response
   */
  async refresh(req: Request, res: Response): Promise<{ accessToken: string }> {
    const { accessToken } = await this.tokens.rotateRefresh(req, res);
    return { accessToken };
  }

  /**
   * 개발 환경 한정: accountId 만으로 access token을 즉시 발급한다.
   *
   * 운영자/FE가 OIDC 흐름을 거치지 않고 시드 데이터의 accountId 로 곧장
   * GraphQL API를 시험하기 위함. production 환경에서는 controller 입구에서
   * 차단된다.
   *
   * @param accountId 발급 대상 account id
   * @returns 발급된 access token + 만료(초)
   */
  async issueDevAccessToken(accountId: bigint): Promise<{
    accessToken: string;
    tokenType: 'Bearer';
    expiresInSeconds: number;
  }> {
    const account = await this.accounts.findAccountForJwt(accountId);
    if (!account) {
      throw new NotFoundException('Account not found.');
    }
    if (account.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active.');
    }

    const accessToken = this.tokens.signAccessToken(accountId);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds: this.tokens.getAccessExpiresSeconds(),
    };
  }

  /**
   * 판매자 refresh 재발급
   *
   * @param req Request
   * @param res Response
   */
  async refreshSeller(
    req: Request,
    res: Response,
  ): Promise<{ accessToken: string; accountStatus: AccountStatus }> {
    const { accessToken, accountId } = await this.tokens.rotateRefresh(
      req,
      res,
    );
    const seller =
      await this.sellerCredentials.findSellerCredentialByAccountId(accountId);
    if (!seller || seller.seller_account.account_type !== AccountType.SELLER) {
      throw new UnauthorizedException('Invalid seller refresh token.');
    }

    return {
      accessToken,
      accountStatus: seller.seller_account.status,
    };
  }

  /**
   * 판매자 로그아웃
   *
   * @param req Request
   * @param res Response
   */
  async logoutSeller(req: Request, res: Response): Promise<void> {
    const refreshToken = req.cookies?.[AUTH_COOKIE.REFRESH] as
      | string
      | undefined;

    if (!refreshToken)
      throw new UnauthorizedException('Missing refresh token.');

    const tokenHash = this.tokens.sha256Hex(refreshToken);
    const session =
      await this.refreshSessions.findActiveRefreshSessionByHash(tokenHash);
    if (!session) throw new UnauthorizedException('Invalid refresh token.');

    const seller = await this.sellerCredentials.findSellerCredentialByAccountId(
      session.account_id,
    );
    if (!seller || seller.seller_account.account_type !== AccountType.SELLER) {
      throw new UnauthorizedException('Invalid seller refresh token.');
    }

    await this.refreshSessions.revokeRefreshSession(session.id);

    this.tokens.clearRefreshCookie(res);
  }

  /**
   * 로그아웃:
   * - refresh 세션 revoke
   * - refresh 쿠키 삭제
   *
   * @param req Request
   * @param res Response
   */
  async logout(req: Request, res: Response): Promise<void> {
    const refreshToken = req.cookies?.[AUTH_COOKIE.REFRESH] as
      | string
      | undefined;

    if (refreshToken) {
      const tokenHash = this.tokens.sha256Hex(refreshToken);
      const session =
        await this.refreshSessions.findActiveRefreshSessionByHash(tokenHash);
      if (session) await this.refreshSessions.revokeRefreshSession(session.id);
    }

    this.tokens.clearRefreshCookie(res);
  }

  /**
   * 판매자 비밀번호를 변경한다.
   *
   * @param args 변경 파라미터
   */
  async changeSellerPassword(args: {
    accountId: bigint;
    currentPassword: string;
    newPassword: string;
    req: Request;
  }): Promise<void> {
    const credential =
      await this.sellerCredentials.findSellerCredentialByAccountId(
        args.accountId,
      );
    if (!credential) throw new UnauthorizedException('Seller not found.');
    if (credential.seller_account.account_type !== AccountType.SELLER) {
      throw new ForbiddenException('Only SELLER account is allowed.');
    }

    const { currentPassword, newPassword } = args;

    const isCurrentPasswordValid = await argon2.verify(
      credential.password_hash,
      currentPassword,
    );
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is invalid.');
    }

    const isSamePassword = await argon2.verify(
      credential.password_hash,
      newPassword,
    );
    if (isSamePassword) {
      throw new BadRequestException(
        'New password must be different from current password.',
      );
    }

    const now = this.clock.now();
    const newHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    await this.sellerCredentials.updateSellerPasswordHash({
      sellerAccountId: args.accountId,
      passwordHash: newHash,
      now,
    });
    await this.refreshSessions.revokeAllRefreshSessions(args.accountId, now);

    await this.auditLogs.createAuditLog({
      actorAccountId: args.accountId,
      storeId: credential.seller_account.store?.id ?? null,
      targetType: AuditTargetType.CHANGE_PASSWORD,
      targetId: args.accountId,
      action: AuditActionType.UPDATE,
      afterJson: {
        changedAt: now.toISOString(),
      },
      ipAddress: getIp(args.req),
      userAgent: getUserAgent(args.req),
    });
  }

  /**
   * 현재 로그인 사용자 정보를 반환한다.
   *
   * @param accountId accountId(BigInt)
   */
  async me(accountId: bigint) {
    const account = await this.accounts.findAccountForMe(accountId);
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
    pick('iss');
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
}
