import { Injectable } from '@nestjs/common';
import { AccountType, IdentityProvider } from '@prisma/client';

import { PrismaService } from 'src/prisma';

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
        deleted_at: null,
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
      where: { email, deleted_at: null },
      include: { user_profile: true },
    });
  }

  /**
   * Identity가 없을 때, 계정을 만들거나(또는 이메일로 기존 계정에 붙여서) Identity를 upsert 한다.
   *
   * 정책:
   * - (provider, subject)로 우선 식별
   * - 없으면 email이 있고 검증 가능하면(emailVerified=true) email로 기존 계정에 연결 시도
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
      const found = await tx.accountIdentity.findFirst({
        where: {
          provider: args.provider,
          provider_subject: args.providerSubject,
          deleted_at: null,
        },
        include: {
          account: {
            include: { user_profile: true },
          },
        },
      });

      const now = new Date();

      if (found) {
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
          await tx.userProfile.create({
            data: {
              account_id: found.account_id,
              nickname:
                args.providerDisplayName?.trim() ||
                (args.providerEmail
                  ? args.providerEmail.split('@')[0]
                  : 'user'),
              profile_image_url: args.providerProfileImageUrl ?? null,
            },
          });
        }

        const account = await tx.account.findUnique({
          where: { id: found.account_id },
          include: { user_profile: true },
        });

        return { account };
      }

      // 신규 identity: email로 기존 계정 연결(verified만)
      let accountId: bigint | null = null;

      if (args.providerEmail && args.emailVerified) {
        const existingByEmail = await tx.account.findFirst({
          where: { email: args.providerEmail, deleted_at: null },
        });
        if (existingByEmail) accountId = existingByEmail.id;
      }

      if (!accountId) {
        const createdAccount = await tx.account.create({
          data: {
            account_type: AccountType.USER,
            status: 'ACTIVE',
            email:
              args.providerEmail && args.emailVerified
                ? args.providerEmail
                : null,
            name: args.providerDisplayName ?? null,
          },
        });
        accountId = createdAccount.id;

        await tx.userProfile.create({
          data: {
            account_id: accountId,
            nickname:
              args.providerDisplayName?.trim() ||
              (args.providerEmail ? args.providerEmail.split('@')[0] : 'user'),
            profile_image_url: args.providerProfileImageUrl ?? null,
          },
        });
      }

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

      const account = await tx.account.findUnique({
        where: { id: accountId },
        include: { user_profile: true },
      });

      return { account };
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
        deleted_at: null,
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
   * accountId 기준으로 유저를 조회한다(soft-delete 제외).
   *
   * @param accountId account id
   */
  async findAccountForMe(accountId: bigint) {
    return this.prisma.account.findFirst({
      where: { id: accountId, deleted_at: null },
      include: { user_profile: true },
    });
  }
}
