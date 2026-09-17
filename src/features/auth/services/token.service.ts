import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';

import { DomainException } from '@/common/errors/error-catalog';
import { getEnvAsNumber } from '@/common/helpers/config.helper';
import {
  generateRandomToken,
  sha256Hex as sha256HexUtil,
} from '@/common/utils/crypto';
import { tryClientIp, tryUserAgent } from '@/common/utils/http-meta';
import { AuthCookieOptions } from '@/features/auth/helpers/auth-cookie-options.helper';
import { AuthCookie } from '@/features/auth/helpers/auth-cookie.helper';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';
import type { AccessTokenPayload } from '@/global/auth/types/jwt-payload.type';

@Injectable()
export class TokenService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessions: IRefreshSessionRepository,
  ) {}

  signAccessToken(accountId: bigint): string {
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

  getAccessExpiresSeconds(): number {
    return getEnvAsNumber(this.config, 'JWT_ACCESS_EXPIRES_SECONDS', 900);
  }

  async issueAuthTokens(args: {
    accountId: bigint;
    req: Request;
    res: Response;
  }): Promise<{ accessToken: string }> {
    const accessToken = this.signAccessToken(args.accountId);

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

    AuthCookie.setRefreshCookie(args.res, {
      refreshToken,
      refreshMaxAgeMs: refreshDays * 86400 * 1000,
      cookieDomain: AuthCookieOptions.getCookieDomain(this.config),
      secure: AuthCookieOptions.isCookieSecure(this.config),
      sameSite: AuthCookieOptions.getCookieSameSite(this.config),
    });

    return { accessToken };
  }

  async rotateRefresh(
    req: Request,
    res: Response,
  ): Promise<{ accessToken: string; accountId: bigint }> {
    const refreshToken = req.cookies?.[AUTH_COOKIE.REFRESH] as
      string | undefined;

    if (!refreshToken) {
      throw new DomainException('MISSING_REFRESH_TOKEN');
    }

    const tokenHash = this.sha256Hex(refreshToken);
    const session =
      await this.refreshSessions.findActiveRefreshSessionByHash(tokenHash);
    if (!session) throw new DomainException('INVALID_REFRESH_TOKEN');

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

    const accessToken = this.signAccessToken(session.account_id);

    AuthCookie.setRefreshCookie(res, {
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

  clearRefreshCookie(res: Response): void {
    AuthCookie.clearRefreshCookie(
      res,
      AuthCookieOptions.getCookieDomain(this.config),
      AuthCookieOptions.isCookieSecure(this.config),
      AuthCookieOptions.getCookieSameSite(this.config),
    );
  }

  private generateRefreshToken(): string {
    return generateRandomToken(32);
  }

  private getRefreshDays(): number {
    return getEnvAsNumber(this.config, 'AUTH_REFRESH_EXPIRES_DAYS', 30);
  }
}
