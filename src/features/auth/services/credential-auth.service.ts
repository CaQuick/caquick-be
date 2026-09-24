import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import type { Request, Response } from 'express';

import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import { tryClientIp, tryUserAgent } from '@/common/utils/http-meta';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  ACCOUNT_CREDENTIAL_REPOSITORY,
  type AccountCredentialWithAccount,
  type IAccountCredentialRepository,
} from '@/features/auth/repositories/account-credential.repository.interface';
import {
  REFRESH_SESSION_REPOSITORY,
  type IRefreshSessionRepository,
} from '@/features/auth/repositories/refresh-session.repository.interface';
import { TokenService } from '@/features/auth/services/token.service';
import {
  type AccountStatus,
  AuditActionType,
  AuditTargetType,
} from '@/generated/prisma/client';
import { type AccountRole, TokenBlacklistService } from '@/global/auth';
import { AUTH_COOKIE } from '@/global/auth/constants/auth-cookie.constants';

export type CredentialRole = Exclude<AccountRole, 'USER'>;

export interface CredentialLoginResult {
  accessToken: string;
  accountStatus: AccountStatus;
  /** 관리자가 지정한 초기/초기화 비밀번호 상태. true면 변경 전까지 다른 API가 거부된다. */
  mustChangePassword: boolean;
}

/**
 * 거부 경로의 더미 검증용 argon2id 해시. 실제 비밀번호와 무관하며 검증은 항상 실패한다.
 * 존재하지 않는 username을 즉시 거부하면 응답 시간 차이로 관리자 username을 열거할 수 있다.
 */
const TIMING_EQUALIZER_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$w0khoJExaZKsA5QJQiOJQA$6EQ02PMC/KY7CFsHpVDIuZFuTkq7myZhnEPkywumqSs';

/** SELLER·ADMIN 공용 — 계정 타입은 호출부(REST 경로)가 role로 고정한다. */
@Injectable()
export class CredentialAuthService {
  constructor(
    private readonly tokens: TokenService,
    @Inject(ACCOUNT_CREDENTIAL_REPOSITORY)
    private readonly credentials: IAccountCredentialRepository,
    @Inject(REFRESH_SESSION_REPOSITORY)
    private readonly refreshSessions: IRefreshSessionRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
    private readonly clock: ClockService,
    private readonly blacklist: TokenBlacklistService,
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
      throw new DomainException('INVALID_CREDENTIALS');
    }

    const credential =
      await this.credentials.findCredentialByUsername(username);
    // 존재 여부·타입 불일치·비밀번호 오류를 같은 메시지로 뭉개 계정 열거를 막는다.
    // 응답 시간으로도 구분되지 않게, 거부 경로에서도 argon2.verify를 한 번 태운다.
    const roleMatches = credential?.account.account_type === args.role;
    const isPasswordValid = await argon2.verify(
      roleMatches ? credential.password_hash : TIMING_EQUALIZER_HASH,
      password,
    );
    if (!credential || !roleMatches || !isPasswordValid) {
      throw new DomainException('INVALID_CREDENTIALS');
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
    // 회전 전에 세션 주인의 타입을 확인한다 — 타입이 다른 쿠키(판매자 쿠키로 관리자 경로)에
    // 새 세션을 발급하거나 기존 세션을 폐기하면 안 된다.
    const { credential } = await this.requireSessionCredential(
      args.role,
      args.req,
    );
    const { accessToken } = await this.tokens.rotateRefresh(args.req, args.res);
    return this.toResult(accessToken, credential);
  }

  async logout(args: {
    role: CredentialRole;
    req: Request;
    res: Response;
  }): Promise<void> {
    const { session } = await this.requireSessionCredential(
      args.role,
      args.req,
    );
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
      throw new DomainException('CREDENTIAL_NOT_FOUND');
    }
    if (credential.account.account_type !== args.role) {
      throw new DomainException('ROLE_MISMATCH');
    }

    const { currentPassword, newPassword } = args;

    const isCurrentPasswordValid = await argon2.verify(
      credential.password_hash,
      currentPassword,
    );
    if (!isCurrentPasswordValid) {
      throw new DomainException('CURRENT_PASSWORD_INVALID');
    }

    const isSamePassword = await argon2.verify(
      credential.password_hash,
      newPassword,
    );
    if (isSamePassword) {
      throw new DomainException('PASSWORD_UNCHANGED');
    }

    const now = this.clock.now();
    const newHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
    });

    // 교체·세션 무효화·감사를 한 트랜잭션에서(P1-12)
    await this.credentials.changePassword(
      {
        accountId: args.accountId,
        passwordHash: newHash,
        now,
      },
      () => ({
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
      }),
    );
    // 커밋 뒤 — 세션은 tx에서 끊겼고, 변경 전에 발급된 액세스 토큰만 막는다(새 비밀번호로 받은 새 토큰은 통과)
    await this.blacklist.blockCredentials(args.accountId, now);
  }

  private async requireSessionCredential(
    role: CredentialRole,
    req: Request,
  ): Promise<{
    session: { id: bigint; account_id: bigint };
    credential: AccountCredentialWithAccount;
  }> {
    const refreshToken = req.cookies?.[AUTH_COOKIE.REFRESH] as
      string | undefined;
    if (!refreshToken) {
      throw new DomainException('MISSING_REFRESH_TOKEN');
    }

    const session = await this.refreshSessions.findActiveRefreshSessionByHash(
      this.tokens.sha256Hex(refreshToken),
    );
    if (!session) {
      throw new DomainException('INVALID_REFRESH_TOKEN');
    }

    const credential = await this.credentials.findCredentialByAccountId(
      session.account_id,
    );
    if (!credential || credential.account.account_type !== role) {
      throw new DomainException('INVALID_REFRESH_TOKEN');
    }
    return { session, credential };
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
