import { Injectable } from '@nestjs/common';

import { nextStatusChangedAt } from '@/common/utils/status-version';
import { buildWithdrawnProviderSubject } from '@/common/utils/withdrawn-identity';
import {
  type AccountType,
  type IdentityProvider,
  Prisma,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

export interface UserAccountIdentity {
  provider: IdentityProvider;
  last_login_at: Date | null;
}

export interface UserAccountWithProfile {
  id: bigint;
  account_type: AccountType;
  email: string | null;
  name: string | null;
  deleted_at: Date | null;
  user_profile: {
    nickname: string;
    birth_date: Date | null;
    phone_number: string | null;
    profile_image_url: string | null;
    onboarding_completed_at: Date | null;
    deleted_at: Date | null;
  } | null;
  account_identities: UserAccountIdentity[];
}

/** 구매자 계정·프로필(온보딩·수정·탈퇴)과 활성 사용자 조회. 구매자 화면 서비스(review·notification·mypage)가 배럴로 주입받는다. */
@Injectable()
export class AccountUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAccountWithProfile(
    accountId: bigint,
    options?: { withDeleted?: boolean },
  ): Promise<UserAccountWithProfile | null> {
    return this.prisma.account.findFirst({
      where: {
        id: accountId,
        ...(options?.withDeleted ? { deleted_at: undefined } : {}),
      },
      include: {
        user_profile: true,
        // 최근 로그인 순으로 정렬해 FE가 "최근 로그인 provider"를 별도 정렬 없이 표시한다
        account_identities: {
          where: activeWhere,
          orderBy: [{ last_login_at: 'desc' }, { id: 'asc' }],
          select: { provider: true, last_login_at: true },
        },
      },
    });
  }

  async isNicknameTaken(
    nickname: string,
    excludeAccountId?: bigint,
  ): Promise<boolean> {
    const found = await this.prisma.userProfile.findFirst({
      where: {
        nickname,
        ...(excludeAccountId ? { account_id: { not: excludeAccountId } } : {}),
      },
      select: { id: true },
    });
    return Boolean(found);
  }

  async completeOnboarding(args: {
    accountId: bigint;
    name?: string | null;
    nickname: string;
    birthDate?: Date | null;
    phoneNumber?: string | null;
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (args.name) {
        await tx.account.updateMany({
          where: { id: args.accountId, name: null },
          data: { name: args.name },
        });
      }

      await tx.userProfile.update({
        where: { account_id: args.accountId },
        data: {
          nickname: args.nickname,
          birth_date: args.birthDate ?? null,
          phone_number: args.phoneNumber ?? null,
          onboarding_completed_at: args.now,
        },
      });
    });
  }

  async updateProfile(args: {
    accountId: bigint;
    nickname?: string;
    name?: string;
    birthDate?: Date | null;
    phoneNumber?: string | null;
  }): Promise<void> {
    const hasName = args.name !== undefined;
    const hasProfileFields =
      args.nickname !== undefined ||
      args.birthDate !== undefined ||
      args.phoneNumber !== undefined;

    // name은 account, 나머지는 user_profile — 두 테이블 부분 실패를 막으려고 트랜잭션으로 묶는다
    await this.prisma.$transaction(async (tx) => {
      if (hasName) {
        await tx.account.update({
          where: { id: args.accountId },
          data: { name: args.name },
        });
      }
      if (hasProfileFields) {
        await tx.userProfile.update({
          where: { account_id: args.accountId },
          data: {
            ...(args.nickname !== undefined ? { nickname: args.nickname } : {}),
            ...(args.birthDate !== undefined
              ? { birth_date: args.birthDate }
              : {}),
            ...(args.phoneNumber !== undefined
              ? { phone_number: args.phoneNumber }
              : {}),
          },
        });
      }
    });
  }

  async updateProfileImage(args: {
    accountId: bigint;
    profileImageUrl: string | null;
  }): Promise<void> {
    await this.prisma.userProfile.update({
      where: { account_id: args.accountId },
      data: { profile_image_url: args.profileImageUrl },
    });
  }

  /** @returns changedAt — 블랙리스트 버전(status_changed_at). 호출자가 커밋 뒤 같은 값으로 등록한다. */
  async softDeleteAccount(args: {
    accountId: bigint;
    deletedNickname: string;
    now: Date;
  }): Promise<{ changedAt: Date }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.userProfile.update({
        where: { account_id: args.accountId },
        data: {
          nickname: args.deletedNickname,
          deleted_at: args.now,
        },
      });

      await tx.account.update({
        where: { id: args.accountId },
        data: {
          deleted_at: args.now,
          email: null,
        },
      });
      // 잠긴 행의 이전 버전보다 항상 크게(블랙리스트 버전) — 갱신으로 행을 잠근 뒤 읽는다
      const locked = await tx.account.findFirst({
        where: { id: args.accountId, deleted_at: { not: null } },
        select: { status_changed_at: true },
      });
      const changedAt = nextStatusChangedAt(
        args.now,
        locked?.status_changed_at,
      );
      await tx.account.update({
        where: { id: args.accountId },
        data: { status_changed_at: changedAt },
      });

      await this.retireAccountIdentities(tx, args.accountId, args.now);

      await tx.authRefreshSession.updateMany({
        where: {
          account_id: args.accountId,
          revoked_at: null,
          ...activeWhere,
        },
        data: {
          revoked_at: args.now,
          deleted_at: args.now,
        },
      });
      return { changedAt };
    });
  }

  /**
   * soft-delete만 하면 (provider, provider_subject) UNIQUE가 그대로 남아 같은 소셜 계정으로 재가입할 때
   * identity를 새로 만들 수 없다(MySQL unique index는 deleted_at을 보지 않는다). subject를 익명화해 자리를 비운다.
   * updateMany로는 기존 값 기반 갱신이 안 돼 row 단위로 처리한다(연동 수는 provider 수준이라 비용 무관).
   */
  private async retireAccountIdentities(
    tx: Prisma.TransactionClient,
    accountId: bigint,
    now: Date,
  ): Promise<void> {
    const identities = await tx.accountIdentity.findMany({
      where: { account_id: accountId },
      select: { id: true, provider_subject: true },
    });

    for (const identity of identities) {
      await tx.accountIdentity.update({
        where: { id: identity.id },
        data: {
          provider_subject: buildWithdrawnProviderSubject(
            accountId,
            identity.provider_subject,
          ),
          deleted_at: now,
        },
      });
    }
  }
}
