import { Injectable } from '@nestjs/common';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  IdentityProvider,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma';

/**
 * 인증 Repository
 */
@Injectable()
export class AuthRepository {
  /**
   * @param prisma PrismaService
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * provider + subject로 AccountIdentity를 조회한다(soft-delete 제외).
   *
   * @param provider provider
   * @param providerSubject subject
   */
  async findIdentityByProviderSubject(
    provider: IdentityProvider,
    providerSubject: string,
  ) {
    return this.prisma.accountIdentity.findFirst({
      where: {
        provider,
        provider_subject: providerSubject,
      },
      include: {
        account: {
          include: {
            user_profile: true,
          },
        },
      },
    });
  }

  /**
   * 이메일(verified 전제)로 기존 계정을 찾는다(soft-delete 제외).
   *
   * @param email email
   */
  async findAccountByEmail(email: string) {
    return this.prisma.account.findFirst({
      where: { email },
      include: { user_profile: true },
    });
  }

  /**
   * Identity가 없을 때, 계정을 만들거나(또는 이메일로 기존 계정에 붙여서) Identity를 upsert 한다.
   *
   * 정책:
   * - (provider, subject)로 우선 식별
   * - 없으면 신규 계정 생성
   *
   * @param args 생성/연결 정보
   */
  async upsertUserByOidcIdentity(args: {
    provider: IdentityProvider;
    providerSubject: string;
    providerEmail?: string;
    emailVerified: boolean;
    providerDisplayName?: string;
    providerProfileImageUrl?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      // 기존 Identity 조회
      const found = await tx.accountIdentity.findFirst({
        where: {
          provider: args.provider,
          provider_subject: args.providerSubject,
        },
        include: {
          account: {
            include: { user_profile: true },
          },
        },
      });

      const now = new Date();

      // 기존 Identity가 있으면 업데이트
      if (found) {
        return this.updateExistingIdentity(tx, found, args, now);
      }

      // 신규 Identity 생성
      return this.createNewIdentity(tx, args, now);
    });
  }

  /**
   * 기존 Identity와 연결된 계정을 업데이트한다.
   */
  private async updateExistingIdentity(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    found: {
      id: bigint;
      account_id: bigint;
      account: {
        id: bigint;
        email: string | null;
        name: string | null;
        user_profile: { nickname: string } | null;
      };
    },
    args: {
      providerEmail?: string;
      providerDisplayName?: string;
      providerProfileImageUrl?: string;
    },
    now: Date,
  ) {
    // Identity 정보 업데이트
    await tx.accountIdentity.update({
      where: { id: found.id },
      data: {
        provider_email: args.providerEmail,
        provider_display_name: args.providerDisplayName,
        provider_profile_image_url: args.providerProfileImageUrl,
        last_login_at: now,
        updated_at: now,
      },
    });

    // account email/name은 null일 때만 채움(변경 불가 정책)
    await tx.account.update({
      where: { id: found.account_id },
      data: {
        email: found.account.email ?? args.providerEmail ?? null,
        name: found.account.name ?? args.providerDisplayName ?? null,
      },
    });

    // profile이 없으면 최소 nickname으로 생성
    if (!found.account.user_profile) {
      await this.createUserProfile(
        tx,
        found.account_id,
        args.providerDisplayName,
        args.providerEmail,
        args.providerProfileImageUrl,
      );
    }

    const account = await tx.account.findFirst({
      where: { id: found.account_id },
      include: { user_profile: true },
    });

    return { account };
  }

  /**
   * 신규 Identity를 생성하고 계정에 연결한다.
   */
  private async createNewIdentity(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    args: {
      provider: IdentityProvider;
      providerSubject: string;
      providerEmail?: string;
      emailVerified: boolean;
      providerDisplayName?: string;
      providerProfileImageUrl?: string;
    },
    now: Date,
  ) {
    // 신규 계정을 생성한다.
    const accountId = await this.createNewAccount(
      tx,
      args.providerEmail,
      args.emailVerified,
      args.providerDisplayName,
      args.providerProfileImageUrl,
    );

    // Identity 생성
    await tx.accountIdentity.create({
      data: {
        account_id: accountId,
        provider: args.provider,
        provider_subject: args.providerSubject,
        provider_email: args.providerEmail,
        provider_display_name: args.providerDisplayName,
        provider_profile_image_url: args.providerProfileImageUrl,
        last_login_at: now,
      },
    });

    const account = await tx.account.findFirst({
      where: { id: accountId },
      include: { user_profile: true },
    });

    return { account };
  }

  /**
   * 신규 계정을 생성한다.
   */
  private async createNewAccount(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    email?: string,
    emailVerified?: boolean,
    displayName?: string,
    profileImageUrl?: string,
  ): Promise<bigint> {
    const createdAccount = await tx.account.create({
      data: {
        account_type: AccountType.USER,
        status: 'ACTIVE',
        email: email && emailVerified ? email : null,
        name: displayName ?? null,
      },
    });

    await this.createUserProfile(
      tx,
      createdAccount.id,
      displayName,
      email,
      profileImageUrl,
    );

    return createdAccount.id;
  }

  /**
   * UserProfile을 생성한다.
   */
  private async createUserProfile(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    accountId: bigint,
    displayName?: string,
    email?: string,
    profileImageUrl?: string,
  ): Promise<void> {
    const nickname =
      displayName?.trim() || (email ? email.split('@')[0] : 'user');

    await tx.userProfile.create({
      data: {
        account_id: accountId,
        nickname,
        profile_image_url: profileImageUrl ?? null,
      },
    });
  }

  /**
   * refresh session을 생성한다(토큰은 hash만 저장).
   *
   * @param args 세션 생성 정보
   */
  async createRefreshSession(args: {
    accountId: bigint;
    tokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    expiresAt: Date;
  }) {
    return this.prisma.authRefreshSession.create({
      data: {
        account_id: args.accountId,
        token_hash: args.tokenHash,
        user_agent: args.userAgent ?? null,
        ip_address: args.ipAddress ?? null,
        expires_at: args.expiresAt,
      },
    });
  }

  /**
   * refresh token hash로 세션을 조회한다(유효/미삭제만).
   *
   * @param tokenHash refresh token hash(sha256 hex)
   */
  async findActiveRefreshSessionByHash(tokenHash: string) {
    const now = new Date();
    return this.prisma.authRefreshSession.findFirst({
      where: {
        token_hash: tokenHash,
        revoked_at: null,
        expires_at: { gt: now },
      },
    });
  }

  /**
   * refresh session을 회전(rotation)한다.
   *
   * - 기존 세션 revoked
   * - 신규 세션 생성
   * - 기존 세션 replaced_by_session_id 연결
   *
   * @param args 회전 정보
   */
  async rotateRefreshSession(args: {
    currentSessionId: bigint;
    accountId: bigint;
    newTokenHash: string;
    userAgent?: string;
    ipAddress?: string;
    newExpiresAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const newSession = await tx.authRefreshSession.create({
        data: {
          account_id: args.accountId,
          token_hash: args.newTokenHash,
          user_agent: args.userAgent ?? null,
          ip_address: args.ipAddress ?? null,
          expires_at: args.newExpiresAt,
        },
      });

      await tx.authRefreshSession.update({
        where: { id: args.currentSessionId },
        data: {
          revoked_at: now,
          replaced_by_session_id: newSession.id,
          updated_at: now,
        },
      });

      return newSession;
    });
  }

  /**
   * refresh session을 revoke 처리한다.
   *
   * @param sessionId session id
   */
  async revokeRefreshSession(sessionId: bigint) {
    const now = new Date();
    return this.prisma.authRefreshSession.update({
      where: { id: sessionId },
      data: { revoked_at: now, updated_at: now },
    });
  }

  /**
   * 특정 계정의 활성 refresh session을 모두 revoke 처리한다.
   *
   * @param accountId account id
   * @param now 기준 시각
   */
  async revokeAllRefreshSessions(accountId: bigint, now: Date): Promise<void> {
    await this.prisma.authRefreshSession.updateMany({
      where: {
        account_id: accountId,
        revoked_at: null,
      },
      data: {
        revoked_at: now,
        updated_at: now,
      },
    });
  }

  /**
   * access token 검증용으로 계정을 조회한다.
   *
   * @param accountId account id
   */
  async findAccountForJwt(accountId: bigint) {
    return this.prisma.account.findFirst({
      where: { id: accountId },
      select: {
        id: true,
        status: true,
        account_type: true,
      },
    });
  }

  /**
   * accountId 기준으로 유저를 조회한다(soft-delete 제외).
   *
   * @param accountId account id
   */
  async findAccountForMe(accountId: bigint) {
    return this.prisma.account.findFirst({
      where: { id: accountId },
      include: { user_profile: true },
    });
  }

  /**
   * username 기준 판매자 자격정보를 조회한다.
   *
   * @param username 판매자 username
   */
  async findSellerCredentialByUsername(username: string) {
    return this.prisma.sellerCredential.findFirst({
      where: { username },
      include: {
        seller_account: {
          select: {
            id: true,
            account_type: true,
            status: true,
            store: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * 계정 ID 기준 판매자 자격정보를 조회한다.
   *
   * @param accountId account id
   */
  async findSellerCredentialByAccountId(accountId: bigint) {
    return this.prisma.sellerCredential.findFirst({
      where: {
        seller_account_id: accountId,
      },
      include: {
        seller_account: {
          select: {
            id: true,
            account_type: true,
            status: true,
            store: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * 판매자 최근 로그인 시각을 갱신한다.
   *
   * @param sellerAccountId seller account id
   * @param now 기준 시각
   */
  async updateSellerLastLogin(
    sellerAccountId: bigint,
    now: Date,
  ): Promise<void> {
    await this.prisma.sellerCredential.update({
      where: { seller_account_id: sellerAccountId },
      data: {
        last_login_at: now,
        updated_at: now,
      },
    });
  }

  /**
   * 판매자 비밀번호 해시를 갱신한다.
   *
   * @param sellerAccountId seller account id
   * @param passwordHash 새 비밀번호 해시
   * @param now 기준 시각
   */
  async updateSellerPasswordHash(args: {
    sellerAccountId: bigint;
    passwordHash: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.sellerCredential.update({
      where: { seller_account_id: args.sellerAccountId },
      data: {
        password_hash: args.passwordHash,
        password_updated_at: args.now,
        updated_at: args.now,
      },
    });
  }

  /**
   * 감사 로그를 생성한다.
   */
  async createAuditLog(args: {
    actorAccountId: bigint;
    storeId?: bigint | null;
    targetType: AuditTargetType;
    targetId: bigint;
    action: AuditActionType;
    beforeJson?: Prisma.InputJsonValue | null;
    afterJson?: Prisma.InputJsonValue | null;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actor_account_id: args.actorAccountId,
        store_id: args.storeId ?? null,
        target_type: args.targetType,
        target_id: args.targetId,
        action: args.action,
        before_json:
          args.beforeJson === null ? Prisma.JsonNull : args.beforeJson,
        after_json: args.afterJson === null ? Prisma.JsonNull : args.afterJson,
        ip_address: args.ipAddress ?? null,
        user_agent: args.userAgent ?? null,
      },
    });
  }
}
