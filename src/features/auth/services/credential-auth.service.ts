import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType } from '@prisma/client';
import argon2 from 'argon2';
import type { Request, Response } from 'express';

import { ClockService } from '@/common/providers/clock.service';
import { tryClientIp, tryUserAgent } from '@/common/utils/http-meta';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AUTH_ERROR_MESSAGES } from '@/features/auth/constants/auth-error-messages';
import {
  ACCOUNT_CREDENTIAL_REPOSITORY,
  type AccountCredentialWithAccount,
  type IAccountCredentialRepository,
} from '@/features/auth/repositories/account-credential.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import type {
  CredentialLoginResult,
  CredentialRole,
  ICredentialAuthService,
} from '@/features/auth/services/credential-auth.service.interface';
import {
  TOKEN_SERVICE,
  type ITokenService,
} from '@/features/auth/services/token.service.interface';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

/**
 * username/password 자격증명 로그인/refresh/logout/changePassword 전담 서비스.
 * SELLER·ADMIN 공용 — 계정 타입은 호출부(REST 경로)가 role로 고정한다.
 */
@Injectable()
export class CredentialAuthService implements ICredentialAuthService {
  /**
   * @param tokens TokenService
   * @param credentials AccountCredentialRepository
   * @param refreshSessions RefreshSessionRepository
   * @param auditLogs AuditLogRepository
   * @param clock ClockService
   */
  constructor(
    @Inject(TOKEN_SERVICE)
    private readonly tokens: ITokenService,
    @Inject(ACCOUNT_CREDENTIAL_REPOSITORY)
    private readonly credentials: IAccountCredentialRepository,
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessions: IRefreshSessionRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
    private readonly clock: ClockService,
  ) {}

  async login(args: {
    role: CredentialRole;
    username: string;
    password: string;
    req: Request;
    res: Response;
  }): Promise<CredentialLoginResult> {
    const username = args.username.trim();
    const password = args.password;

    if (!username || !password.trim()) {
      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    const credential =
      await this.credentials.findCredentialByUsername(username);
    // 존재 여부·타입 불일치·비밀번호 오류를 같은 메시지로 뭉개 계정 열거를 막는다.
    if (!credential || credential.account.account_type !== args.role) {
      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await argon2.verify(
      credential.password_hash,
      password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    const now = this.clock.now();
    await this.credentials.updateLastLogin(credential.account_id, now);

    const { accessToken } = await this.tokens.issueAuthTokens({
      accountId: credential.account_id,
      req: args.req,
      res: args.res,
    });

    return this.toResult(accessToken, credential);
  }

  async refresh(args: {
    role: CredentialRole;
    req: Request;
    res: Response;
  }): Promise<CredentialLoginResult> {
    const { accessToken, accountId } = await this.tokens.rotateRefresh(
      args.req,
      args.res,
    );
    const credential =
      await this.credentials.findCredentialByAccountId(accountId);
    if (!credential || credential.account.account_type !== args.role) {
      throw new UnauthorizedException(
        AUTH_ERROR_MESSAGES.INVALID_REFRESH_TOKEN,
      );
    }

    return this.toResult(accessToken, credential);
  }

  async logout(args: {
    role: CredentialRole;
    req: Request;
    res: Response;
  }): Promise<void> {
    const refreshToken = args.req.cookies?.[AUTH_COOKIE.REFRESH] as
      string | undefined;

    if (!refreshToken) {
      throw new UnauthorizedException(
        AUTH_ERROR_MESSAGES.MISSING_REFRESH_TOKEN,
      );
    }

    const tokenHash = this.tokens.sha256Hex(refreshToken);
    const session =
      await this.refreshSessions.findActiveRefreshSessionByHash(tokenHash);
    if (!session) {
      throw new UnauthorizedException(
        AUTH_ERROR_MESSAGES.INVALID_REFRESH_TOKEN,
      );
    }

    const credential = await this.credentials.findCredentialByAccountId(
      session.account_id,
    );
    if (!credential || credential.account.account_type !== args.role) {
      throw new UnauthorizedException(
        AUTH_ERROR_MESSAGES.INVALID_REFRESH_TOKEN,
      );
    }

    await this.refreshSessions.revokeRefreshSession(session.id);

    this.tokens.clearRefreshCookie(args.res);
  }

  async changePassword(args: {
    role: CredentialRole;
    accountId: bigint;
    currentPassword: string;
    newPassword: string;
    req: Request;
  }): Promise<void> {
    const credential = await this.credentials.findCredentialByAccountId(
      args.accountId,
    );
    if (!credential) {
      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.CREDENTIAL_NOT_FOUND);
    }
    if (credential.account.account_type !== args.role) {
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ROLE_MISMATCH);
    }

    const { currentPassword, newPassword } = args;

    const isCurrentPasswordValid = await argon2.verify(
      credential.password_hash,
      currentPassword,
    );
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException(
        AUTH_ERROR_MESSAGES.CURRENT_PASSWORD_INVALID,
      );
    }

    const isSamePassword = await argon2.verify(
      credential.password_hash,
      newPassword,
    );
    if (isSamePassword) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.PASSWORD_UNCHANGED);
    }

    const now = this.clock.now();
    const newHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    await this.credentials.updatePasswordHash({
      accountId: args.accountId,
      passwordHash: newHash,
      now,
    });
    await this.refreshSessions.revokeAllRefreshSessions(args.accountId, now);

    await this.auditLogs.createAuditLog({
      actorAccountId: args.accountId,
      storeId: credential.account.store?.id ?? null,
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

  private toResult(
    accessToken: string,
    credential: AccountCredentialWithAccount,
  ): CredentialLoginResult {
    return {
      accessToken,
      accountStatus: credential.account.status,
      mustChangePassword: credential.must_change_password,
    };
  }
}
