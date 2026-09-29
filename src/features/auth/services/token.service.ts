import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';

import { DomainException } from '@/common/errors/error-catalog';
import {
  generateRandomToken,
  sha256Hex as sha256HexUtil,
} from '@/common/utils/crypto';
import { tryClientIp, tryUserAgent } from '@/common/utils/http-meta';
import type { AuthConfig } from '@/config/auth.config';
import { AuthCookieOptions } from '@/features/auth/helpers/auth-cookie-options.helper';
import { AuthCookie } from '@/features/auth/helpers/auth-cookie.helper';
import {
  ACCOUNT_REPOSITORY,
  type AccountForJwt,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import { REFRESH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';
import type {
  AccessTokenClaims,
  AccountRole,
} from '@/global/auth/types/jwt-payload.type';

@Injectable()
export class TokenService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessions: IRefreshSessionRepository,
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accounts: IAccountRepository,
  ) {}

  /** iat·exp·iss·aud·kid는 서명 옵션(JwtModule)이 붙인다 — 여기서는 신원 클레임만 만든다. */
  signAccessToken(account: AccountForJwt): string {
    const claims: AccessTokenClaims = {
      sub: account.id.toString(),
      typ: 'access',
      role: account.account_type,
      mustChangePassword: account.credential?.must_change_password ?? false,
      ...(account.store ? { storeId: account.store.id.toString() } : {}),
    };

    return this.jwt.sign(claims);
  }

  /** 발급 시점의 계정 상태를 클레임에 담기 위해 매번 조회한다(재발급 포함). */
  async signAccessTokenFor(accountId: bigint): Promise<string> {
    return this.signAccessToken(await this.requireActiveAccount(accountId));
  }

  private async requireActiveAccount(
    accountId: bigint,
  ): Promise<AccountForJwt> {
    const account = await this.accounts.findAccountForJwt(accountId);
    if (!account) throw new DomainException('SESSION_ACCOUNT_MISSING');
    if (account.status !== 'ACTIVE') {
      throw new DomainException('ACCOUNT_NOT_ACTIVE');
    }
    return account;
  }

  getAccessExpiresSeconds(): number {
    return this.authConfig().jwtAccessExpiresSeconds;
  }

  private authConfig(): AuthConfig {
    return this.config.getOrThrow<AuthConfig>('auth');
  }

  async issueAuthTokens(args: {
    accountId: bigint;
    req: Request;
    res: Response;
  }): Promise<{ accessToken: string }> {
    const account = await this.requireActiveAccount(args.accountId);
    const accessToken = this.signAccessToken(account);

    const refreshToken = this.generateRefreshToken();
    const refreshHash = this.sha256Hex(refreshToken);

    const refreshDays = this.getRefreshDays();
    const expiresAt = new Date(Date.now() + refreshDays * 86400 * 1000);

    await this.refreshSessions.createRefreshSession({
      accountId: args.accountId,
      tokenHash: refreshHash,
      userAgent: tryUserAgent(args.req),
      ipAddress: tryClientIp(args.req),
      expiresAt,
    });

    AuthCookie.setRefreshCookie(args.res, account.account_type, {
      refreshToken,
      refreshMaxAgeMs: refreshDays * 86400 * 1000,
      cookieDomain: AuthCookieOptions.getCookieDomain(this.config),
      secure: AuthCookieOptions.isCookieSecure(this.config),
      sameSite: AuthCookieOptions.getCookieSameSite(this.config),
    });

    return { accessToken };
  }

  readRefreshCookie(role: AccountRole, req: Request): string | undefined {
    return req.cookies?.[REFRESH_COOKIE[role]] as string | undefined;
  }

  /** 이름이 나뉘기 전에 구운 쿠키에는 다른 역할의 세션이 들어 있다 — 그 세션은 회전·폐기하지 않는다. */
  /** 계정이 없으면(탈퇴 등) true — 역할 불일치만 가려내고 계정 상태 판정은 호출부 몫이다. */
  async hasSessionRole(role: AccountRole, accountId: bigint): Promise<boolean> {
    const account = await this.accounts.findAccountForJwt(accountId);
    return !account || account.account_type === role;
  }

  async assertSessionRole(role: AccountRole, accountId: bigint): Promise<void> {
    if (!(await this.hasSessionRole(role, accountId))) {
      throw new DomainException('INVALID_REFRESH_TOKEN');
    }
  }

  async rotateRefresh(
    role: AccountRole,
    req: Request,
    res: Response,
  ): Promise<{ accessToken: string; accountId: bigint }> {
    const refreshToken = this.readRefreshCookie(role, req);

    if (!refreshToken) {
      throw new DomainException('MISSING_REFRESH_TOKEN');
    }

    const tokenHash = this.sha256Hex(refreshToken);
    const session =
      await this.refreshSessions.findActiveRefreshSessionByHash(tokenHash);
    if (!session) throw new DomainException('INVALID_REFRESH_TOKEN');

    await this.assertSessionRole(role, session.account_id);

    const newRefreshToken = this.generateRefreshToken();
    const newTokenHash = this.sha256Hex(newRefreshToken);

    const refreshDays = this.getRefreshDays();
    const newExpiresAt = new Date(Date.now() + refreshDays * 86400 * 1000);

    await this.refreshSessions.rotateRefreshSession({
      currentSessionId: session.id,
      accountId: session.account_id,
      newTokenHash,
      userAgent: tryUserAgent(req),
      ipAddress: tryClientIp(req),
      newExpiresAt,
    });

    const accessToken = await this.signAccessTokenFor(session.account_id);

    AuthCookie.setRefreshCookie(res, role, {
      refreshToken: newRefreshToken,
      refreshMaxAgeMs: refreshDays * 86400 * 1000,
      cookieDomain: AuthCookieOptions.getCookieDomain(this.config),
      secure: AuthCookieOptions.isCookieSecure(this.config),
      sameSite: AuthCookieOptions.getCookieSameSite(this.config),
    });

    return {
      accessToken,
      accountId: session.account_id,
    };
  }

  sha256Hex(raw: string): string {
    return sha256HexUtil(raw);
  }

  clearRefreshCookie(role: AccountRole, res: Response): void {
    AuthCookie.clearRefreshCookie(
      res,
      role,
      AuthCookieOptions.getCookieDomain(this.config),
      AuthCookieOptions.isCookieSecure(this.config),
      AuthCookieOptions.getCookieSameSite(this.config),
    );
  }

  private generateRefreshToken(): string {
    return generateRandomToken(32);
  }

  private getRefreshDays(): number {
    return this.authConfig().refreshExpiresInDays;
  }
}
