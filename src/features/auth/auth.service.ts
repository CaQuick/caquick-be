import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { DomainException } from '@/common/errors/error-catalog';
import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import { TokenService } from '@/features/auth/services/token.service';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

/** 일반 유저용 refresh/logout/dev token. OIDC는 OidcLoginService, 판매자·관리자 자격증명은 CredentialAuthService가 담당한다. */
@Injectable()
export class AuthService {
  constructor(
    private readonly tokens: TokenService,
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accounts: IAccountRepository,
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessions: IRefreshSessionRepository,
  ) {}

  async refresh(req: Request, res: Response): Promise<{ accessToken: string }> {
    const { accessToken } = await this.tokens.rotateRefresh(req, res);
    return { accessToken };
  }

  /** 시드 데이터의 accountId로 OIDC 흐름 없이 GraphQL API를 시험하기 위한 것. production은 controller 입구에서 차단된다. */
  async issueDevAccessToken(accountId: bigint): Promise<{
    accessToken: string;
    tokenType: 'Bearer';
    expiresInSeconds: number;
  }> {
    const account = await this.accounts.findAccountForJwt(accountId);
    if (!account) {
      throw new DomainException('ACCOUNT_NOT_FOUND');
    }
    if (account.status !== 'ACTIVE') {
      throw new DomainException('ACCOUNT_NOT_ACTIVE');
    }

    const accessToken = this.tokens.signAccessToken(account);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds: this.tokens.getAccessExpiresSeconds(),
    };
  }

  async logout(req: Request, res: Response): Promise<void> {
    const refreshToken = req.cookies?.[AUTH_COOKIE.REFRESH] as
      string | undefined;

    if (refreshToken) {
      const tokenHash = this.tokens.sha256Hex(refreshToken);
      const session =
        await this.refreshSessions.findActiveRefreshSessionByHash(tokenHash);
      if (session) await this.refreshSessions.revokeRefreshSession(session.id);
    }

    this.tokens.clearRefreshCookie(res);
  }
}
