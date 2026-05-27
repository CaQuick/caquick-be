import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import {
  TOKEN_SERVICE,
  type ITokenService,
} from '@/features/auth/services/token.service.interface';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

/**
 * 인증/로그인/토큰 발급/갱신 비즈니스 로직 (일반 유저 흐름).
 *
 * 판매자 자격증명 흐름은 SellerCredentialService 가, OIDC 흐름은 OidcLoginService 가 담당한다.
 */
@Injectable()
export class AuthService {
  /**
   * @param tokens TokenService
   * @param accounts AccountRepository
   * @param refreshSessions RefreshSessionRepository
   */
  constructor(
    @Inject(TOKEN_SERVICE)
    private readonly tokens: ITokenService,
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accounts: IAccountRepository,
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessions: IRefreshSessionRepository,
  ) {}

  /**
   * Refresh 토큰으로 access 를 재발급하고 refresh 를 회전한다.
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
}
