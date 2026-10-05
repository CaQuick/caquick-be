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
  readPresentedRefreshToken,
  type RefreshTransport,
} from '@/features/auth/helpers/refresh-transport.helper';
import {
  ACCOUNT_REPOSITORY,
  type AccountForJwt,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import type { AuthRefreshSession } from '@/generated/prisma/client';
import type {
  AccessTokenClaims,
  AccountRole,
} from '@/global/auth/types/jwt-payload.type';

export interface IssuedTokens {
  accessToken: string;
  /** 바디 전달일 때만 — 쿠키 전달은 Set-Cookie로 나간다. */
  refreshToken?: string;
  refreshExpiresAt?: Date;
}

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

  /**
   * iat·exp·iss·aud·kid는 서명 옵션(JwtModule)이 붙인다 — 여기서는 신원 클레임만 만든다.
   * credentialVersion(cv)은 계정 행에서 다시 꺼내지 않는다 — 자격을 확인한 시점의 값이어야 그 뒤 커밋된 변경이 이 토큰을 막는다.
   */
  signAccessToken(
    account: AccountForJwt,
    credentialVersion: Date | null,
  ): string {
    const claims: AccessTokenClaims = {
      sub: account.id.toString(),
      typ: 'access',
      role: account.account_type,
      mustChangePassword: account.credential?.must_change_password ?? false,
      ...(account.store ? { storeId: account.store.id.toString() } : {}),
      cv: versionMs(credentialVersion),
    };

    return this.jwt.sign(claims);
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

  /** credentialVersion = 호출자가 자격을 확인한 시점의 password_updated_at(로그인은 비밀번호 검증 때 읽은 값). 나머지 클레임은 다시 읽는다. */
  async issueAuthTokens(args: {
    accountId: bigint;
    credentialVersion: Date | null;
    req: Request;
    res: Response;
    transport?: RefreshTransport;
  }): Promise<IssuedTokens> {
    const account = await this.requireActiveAccount(args.accountId);
    const accessToken = this.signAccessToken(account, args.credentialVersion);

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
      credentialVersion: args.credentialVersion,
    });

    return {
      accessToken,
      ...this.deliverRefresh(args.res, account.account_type, {
        transport: args.transport ?? 'cookie',
        refreshToken,
        expiresAt,
        refreshDays,
      }),
    };
  }

  /** 전달 방식은 세션 커밋 뒤 응답 조립에서만 갈린다 — 쿠키면 Set-Cookie, 바디면 반환값. */
  private deliverRefresh(
    res: Response,
    role: AccountRole,
    args: {
      transport: RefreshTransport;
      refreshToken: string;
      expiresAt: Date;
      refreshDays: number;
    },
  ): Pick<IssuedTokens, 'refreshToken' | 'refreshExpiresAt'> {
    if (args.transport === 'body') {
      return {
        refreshToken: args.refreshToken,
        refreshExpiresAt: args.expiresAt,
      };
    }
    AuthCookie.setRefreshCookie(res, role, {
      refreshToken: args.refreshToken,
      refreshMaxAgeMs: args.refreshDays * 86400 * 1000,
      cookieDomain: AuthCookieOptions.getCookieDomain(this.config),
      secure: AuthCookieOptions.isCookieSecure(this.config),
      sameSite: AuthCookieOptions.getCookieSameSite(this.config),
    });
    return {};
  }

  /** 이름이 나뉘기 전에 구운 쿠키에는 다른 역할의 세션이 들어 있다 — 그 세션은 회전·폐기하지 않는다. */
  /** 계정이 없으면(탈퇴 등) true — 역할 불일치만 가려내고 계정 상태 판정은 호출부 몫이다. */
  async hasSessionRole(role: AccountRole, accountId: bigint): Promise<boolean> {
    const account = await this.accounts.findAccountForJwt(accountId);
    return !account || account.account_type === role;
  }

  /**
   * 회전 전 확인. 역할이 다르면 세션을 건드리지 않고 거절한다. 자격증명 버전이 다르면 발급 뒤 비밀번호가 바뀐 것이다 —
   * 변경 트랜잭션의 전 세션 폐기를 비껴간 세션(확인 뒤 커밋된 변경과 겹친 로그인·회전)이라 폐기하고 거절한다.
   * 계정이 없으면(탈퇴) 회전의 상태 확인이 거절한다.
   */
  private async assertSessionUsable(
    role: AccountRole,
    session: AuthRefreshSession,
  ): Promise<void> {
    const account = await this.accounts.findAccountForJwt(session.account_id);
    if (!account) return;
    if (account.account_type !== role) {
      throw new DomainException('INVALID_REFRESH_TOKEN');
    }
    if (
      versionMs(session.credential_version) !==
      versionMs(account.credential?.password_updated_at)
    ) {
      await this.refreshSessions.revokeRefreshSession(session.id);
      throw new DomainException('INVALID_REFRESH_TOKEN');
    }
  }

  async rotateRefresh(
    role: AccountRole,
    req: Request,
    res: Response,
  ): Promise<IssuedTokens & { accountId: bigint }> {
    const presented = readPresentedRefreshToken(role, req);

    if (!presented) {
      throw new DomainException('MISSING_REFRESH_TOKEN');
    }

    const tokenHash = this.sha256Hex(presented.token);
    const session =
      await this.refreshSessions.findActiveRefreshSessionByHash(tokenHash);
    if (!session) throw new DomainException('INVALID_REFRESH_TOKEN');

    await this.assertSessionUsable(role, session);

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
      credentialVersion: session.credential_version,
    });

    // 버전은 확인한 세션의 것 — 확인 뒤 커밋된 변경이 있으면 이 토큰은 블랙리스트에, 새 세션은 다음 refresh에서 막힌다
    const accessToken = this.signAccessToken(
      await this.requireActiveAccount(session.account_id),
      session.credential_version,
    );

    return {
      accessToken,
      accountId: session.account_id,
      ...this.deliverRefresh(res, role, {
        transport: presented.transport,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
        refreshDays,
      }),
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

/** 자격증명 버전의 비교·클레임 값. 변경 이력이 없으면(null) 0. */
function versionMs(version: Date | null | undefined): number {
  return version?.getTime() ?? 0;
}
