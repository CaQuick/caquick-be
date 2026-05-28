import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  type AccountStatus,
} from '@prisma/client';
import argon2 from 'argon2';
import type { Request, Response } from 'express';

import { ClockService } from '@/common/providers/clock.service';
import { tryClientIp, tryUserAgent } from '@/common/utils/http-meta';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import {
  SELLER_CREDENTIAL_REPOSITORY,
  type ISellerCredentialRepository,
} from '@/features/auth/repositories/seller-credential.repository.interface';
import type { ISellerCredentialService } from '@/features/auth/services/seller-credential.service.interface';
import {
  TOKEN_SERVICE,
  type ITokenService,
} from '@/features/auth/services/token.service.interface';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

/**
 * 판매자 자격정보 기반 로그인/refresh/logout/changePassword 전담 서비스.
 *
 * AuthService 의 판매자 흐름 4 종을 분리한 결과물.
 */
@Injectable()
export class SellerCredentialService implements ISellerCredentialService {
  /**
   * @param tokens TokenService
   * @param sellerCredentials SellerCredentialRepository
   * @param refreshSessions RefreshSessionRepository
   * @param auditLogs AuditLogRepository
   * @param clock ClockService
   */
  constructor(
    @Inject(TOKEN_SERVICE)
    private readonly tokens: ITokenService,
    @Inject(SELLER_CREDENTIAL_REPOSITORY)
    private readonly sellerCredentials: ISellerCredentialRepository,
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessions: IRefreshSessionRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
    private readonly clock: ClockService,
  ) {}

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
      ipAddress: tryClientIp(args.req),
      userAgent: tryUserAgent(args.req),
    });
  }
}
