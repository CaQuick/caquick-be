import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';

import { getEnvAsNumber } from '@/common/helpers/config.helper';
import { AuthCookieOptions } from '@/features/auth/helpers/auth-cookie-options.helper';
import { AuthCookie } from '@/features/auth/helpers/auth-cookie.helper';
import {
  getIp,
  getUserAgent,
} from '@/features/auth/helpers/auth-request-meta.helper';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import type { ITokenService } from '@/features/auth/services/token.service.interface';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';
import type { AccessTokenPayload } from '@/global/auth/types/jwt-payload.type';

/**
 * 인증 토큰 발급/회전/검증 + refresh 쿠키 관리 서비스.
 *
 * AuthService 의 토큰 관련 책임을 분리한 결과물.
 */
@Injectable()
export class TokenService implements ITokenService {
  /**
   * @param config ConfigService
   * @param jwt JwtService
   * @param refreshSessions RefreshSessionRepository
   */
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
      userAgent: getUserAgent(args.req),
      ipAddress: getIp(args.req),
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
      | string
      | undefined;

    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token.');
    }

    const tokenHash = this.sha256Hex(refreshToken);
    const session =
      await this.refreshSessions.findActiveRefreshSessionByHash(tokenHash);
    if (!session) throw new UnauthorizedException('Invalid refresh token.');

    const newRefreshToken = this.generateRefreshToken();
    const newTokenHash = this.sha256Hex(newRefreshToken);

    const refreshDays = this.getRefreshDays();
    const newExpiresAt = new Date(Date.now() + refreshDays * 86400 * 1000);

    await this.refreshSessions.rotateRefreshSession({
      currentSessionId: session.id,
      accountId: session.account_id,
      newTokenHash,
      userAgent: getUserAgent(req),
      ipAddress: getIp(req),
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
    return createHash('sha256').update(raw).digest('hex');
  }

  clearRefreshCookie(res: Response): void {
    AuthCookie.clearRefreshCookie(
      res,
      AuthCookieOptions.getCookieDomain(this.config),
      AuthCookieOptions.isCookieSecure(this.config),
      AuthCookieOptions.getCookieSameSite(this.config),
    );
  }

  /**
   * refresh token 랜덤 문자열을 생성한다. (32 bytes → 64 hex)
   */
  private generateRefreshToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Refresh 만료(일) 를 반환한다.
   */
  private getRefreshDays(): number {
    return getEnvAsNumber(this.config, 'AUTH_REFRESH_EXPIRES_DAYS', 30);
  }
}
