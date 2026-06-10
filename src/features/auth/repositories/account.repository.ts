import { Injectable } from '@nestjs/common';
import { AccountType, type IdentityProvider } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { buildInitialNickname } from '@/features/auth/helpers/initial-nickname.helper';
import type {
  AccountForJwt,
  AccountIdentityWithAccount,
  AccountWithProfile,
  IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import { PrismaService } from '@/prisma';

/**
 * Account / AccountIdentity / UserProfile Repository 구체 구현.
 */
@Injectable()
export class AccountRepository implements IAccountRepository {
  /**
   * @param prisma PrismaService
   * @param clock ClockService
   */
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
    return this.prisma.$transaction(async (tx) => {
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

      if (found) {
        return this.updateExistingIdentity(tx, found, args, now);
      }

      return this.createNewIdentity(tx, args, now);
    });
  }

  /**
   * 기존 Identity 와 연결된 계정을 업데이트한다.
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

    // account email/name 은 null 일 때만 채움(변경 불가 정책)
    await tx.account.update({
      where: { id: found.account_id },
      data: {
        email: found.account.email ?? args.providerEmail ?? null,
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

  /**
   * 신규 Identity 를 생성하고 계정에 연결한다.
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
   * UserProfile 을 생성한다.
   */
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
      },
    });
  }
}
