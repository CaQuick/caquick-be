import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import { buildWithdrawnProviderSubject } from '@/common/utils/withdrawn-identity';
import { buildInitialNickname } from '@/features/auth/helpers/initial-nickname.helper';
import type {
  AccountForJwt,
  AccountIdentityWithAccount,
  AccountWithProfile,
  IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import {
  AccountType,
  Prisma,
  type IdentityProvider,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

@Injectable()
export class AccountRepository implements IAccountRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  async findIdentityByProviderSubject(
    provider: IdentityProvider,
    providerSubject: string,
  ): Promise<AccountIdentityWithAccount | null> {
    return this.prisma.accountIdentity.findFirst({
      where: {
        provider,
        provider_subject: providerSubject,
        // soft-delete extension 은 top-level where 에만 deleted_at 을 주입한다.
        // 상위 엔티티(account)까지 활성인지는 직접 명시해야 탈퇴 계정이 새어나오지 않는다.
        account: activeWhere,
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

  async findAccountByEmail(email: string): Promise<AccountWithProfile | null> {
    return this.prisma.account.findFirst({
      where: { email },
      include: { user_profile: true },
    });
  }

  async upsertUserByOidcIdentity(args: {
    provider: IdentityProvider;
    providerSubject: string;
    providerEmail?: string;
    emailVerified: boolean;
    providerDisplayName?: string;
    providerProfileImageUrl?: string;
  }): Promise<{ account: AccountWithProfile | null }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
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

        const now = this.clock.now();

        // 탈퇴한 계정의 연동이 남아 있으면 복구가 아니라 재가입이다. nested include라 soft-delete extension이
        // account를 걸러주지 않으므로 직접 확인한다 — 없으면 삭제된 계정을 집어들어 마지막 조회에서만 null이 된다.
        if (found?.account.deleted_at) {
          await this.retireWithdrawnIdentity(tx, found, now);
          return this.createNewIdentity(tx, args, now);
        }

        if (found) {
          return this.updateExistingIdentity(tx, found, args, now);
        }

        return this.createNewIdentity(tx, args, now);
      });
    } catch (error) {
      // Prisma 원문 에러에는 파일 경로·소스 라인이 담겨 있어 그대로 500 본문으로 새어나간다.
      // 도메인 예외로 좁혀서 내보낸다.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new DomainException('ACCOUNT_IDENTITY_CONFLICT');
      }
      throw error;
    }
  }

  /** 탈퇴 시점 처리가 없던 시절의 데이터가 남아 있을 수 있어 로그인 경로에서도 같은 규칙으로 정리한다. */
  private async retireWithdrawnIdentity(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    found: { id: bigint; account_id: bigint; provider_subject: string },
    now: Date,
  ): Promise<void> {
    await tx.accountIdentity.update({
      where: { id: found.id },
      data: {
        provider_subject: buildWithdrawnProviderSubject(
          found.account_id,
          found.provider_subject,
        ),
        deleted_at: now,
      },
    });
  }

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
      emailVerified: boolean;
      providerDisplayName?: string;
      providerProfileImageUrl?: string;
    },
    now: Date,
  ) {
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

    // account email/name은 null일 때만 채운다(변경 불가 정책). email은 신규 가입과 같은 기준(verified만) —
    // 미인증 이메일이 뒤늦게 주입되면 전역 unique와 충돌한다.
    await tx.account.update({
      where: { id: found.account_id },
      data: {
        email:
          found.account.email ??
          this.resolveVerifiedEmail(args.providerEmail, args.emailVerified),
        name: found.account.name ?? args.providerDisplayName ?? null,
      },
    });

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
    const accountId = await this.createNewAccount(
      tx,
      args.providerEmail,
      args.emailVerified,
      args.providerDisplayName,
      args.providerProfileImageUrl,
    );

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
        email: this.resolveVerifiedEmail(email, emailVerified),
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

  /** 미인증 이메일은 저장하지 않는다 — account.email은 사용자에게 노출되는 값이라 provider가 검증한 값만 싣는다. */
  private resolveVerifiedEmail(
    email?: string,
    emailVerified?: boolean,
  ): string | null {
    return email && emailVerified ? email : null;
  }

  private async createUserProfile(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    accountId: bigint,
    displayName?: string,
    email?: string,
    profileImageUrl?: string,
  ): Promise<void> {
    const nickname = buildInitialNickname(accountId, displayName, email);

    await tx.userProfile.create({
      data: {
        account_id: accountId,
        nickname,
        profile_image_url: profileImageUrl ?? null,
      },
    });
  }

  async findAccountForJwt(accountId: bigint): Promise<AccountForJwt | null> {
    return this.prisma.account.findFirst({
      where: { id: accountId },
      select: {
        id: true,
        status: true,
        account_type: true,
        credential: { select: { must_change_password: true } },
        // 판매자 토큰의 storeId 클레임용 — 서비스 분리 후에는 identity가 들고 있을 값이다(P4 federation)
        store: { select: { id: true } },
      },
    });
  }
}
