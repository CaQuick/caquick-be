import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import {
  MAX_NICKNAME_LENGTH,
  MIN_NICKNAME_LENGTH,
} from '@/features/auth/constants/auth-user.constants';
import type { CompleteOnboardingInput } from '@/features/auth/dto/inputs/complete-onboarding.input';
import type { UpdateMyProfileImageInput } from '@/features/auth/dto/inputs/update-my-profile-image.input';
import type { UpdateMyProfileInput } from '@/features/auth/dto/inputs/update-my-profile.input';
import { AccountUserRepository } from '@/features/auth/repositories/account-user.repository';
import { UserBaseService } from '@/features/auth/services/auth-user-base.service';
import type {
  MePayload,
  NicknameAvailability,
} from '@/features/auth/types/auth-user-output.type';
import { TokenBlacklistService } from '@/global/auth';
import { S3Service } from '@/global/storage/s3.service';
import type { CreateUploadUrlOutput } from '@/global/storage/types/storage.types';

@Injectable()
export class UserProfileService extends UserBaseService {
  constructor(
    accounts: AccountUserRepository,
    private readonly s3Service: S3Service,
    private readonly blacklist: TokenBlacklistService,
  ) {
    super(accounts);
  }

  async me(accountId: bigint): Promise<MePayload> {
    const account = await this.requireActiveUser(accountId);
    return this.toMePayload(account);
  }

  async completeOnboarding(
    accountId: bigint,
    input: CompleteOnboardingInput,
  ): Promise<MePayload> {
    const account = await this.requireActiveUser(accountId);

    const nickname = this.normalizeNickname(input.nickname);
    const phoneNumber = this.normalizePhoneNumber(input.phoneNumber);
    const birthDate = this.normalizeBirthDate(input.birthDate);
    const name = this.normalizeName(input.name);

    if (!account.name && !name) {
      throw new DomainException('NAME_REQUIRED');
    }

    const isTaken = await this.accounts.isNicknameTaken(nickname, accountId);
    if (isTaken) throw new DomainException('NICKNAME_TAKEN');

    await this.accounts.completeOnboarding({
      accountId,
      name: account.name ? null : name,
      nickname,
      birthDate,
      phoneNumber,
      now: new Date(),
    });

    return this.me(accountId);
  }

  async updateMyProfile(
    accountId: bigint,
    input: UpdateMyProfileInput,
  ): Promise<MePayload> {
    await this.requireActiveUser(accountId);

    const hasNickname = input.nickname !== undefined;
    const hasName = input.name !== undefined;
    const hasBirthDate = input.birthDate !== undefined;
    const hasPhoneNumber = input.phoneNumber !== undefined;

    if (!hasNickname && !hasName && !hasBirthDate && !hasPhoneNumber) {
      throw new DomainException('NO_FIELDS_TO_UPDATE');
    }

    const nickname = hasNickname
      ? this.normalizeNickname(input.nickname ?? '')
      : undefined;

    if (nickname) {
      const isTaken = await this.accounts.isNicknameTaken(nickname, accountId);
      if (isTaken) throw new DomainException('NICKNAME_TAKEN');
    }

    // 이름은 필수값. DTO가 trim + 빈 문자열 거절을 담당하지만, 정규화 결과가 null인 경우는 방어적으로 reject.
    let name: string | undefined = undefined;
    if (hasName) {
      const normalized = this.normalizeName(input.name);
      if (!normalized) {
        throw new DomainException('NAME_EMPTY');
      }
      name = normalized;
    }

    const birthDate = hasBirthDate
      ? this.normalizeBirthDate(input.birthDate)
      : undefined;
    const phoneNumber = hasPhoneNumber
      ? this.normalizePhoneNumber(input.phoneNumber)
      : undefined;

    await this.accounts.updateProfile({
      accountId,
      ...(hasNickname ? { nickname } : {}),
      ...(hasName ? { name } : {}),
      ...(hasBirthDate ? { birthDate } : {}),
      ...(hasPhoneNumber ? { phoneNumber } : {}),
    });

    return this.me(accountId);
  }

  async updateMyProfileImage(
    accountId: bigint,
    input: UpdateMyProfileImageInput,
  ): Promise<MePayload> {
    await this.requireActiveUser(accountId);

    const profileImageUrl = input.profileImageUrl;

    // 우리가 발급한 presigned URL(이 버킷·해당 계정 prefix)인지 검증 — 클라이언트가 임의 URL을 프로필 이미지로 저장하는 것을 방지한다.
    if (
      !this.s3Service.isOwnedUploadUrl(
        profileImageUrl,
        'PROFILE_IMAGE',
        accountId,
      )
    ) {
      throw new DomainException('INVALID_PROFILE_IMAGE_URL');
    }

    await this.accounts.updateProfileImage({
      accountId,
      profileImageUrl,
    });

    return this.me(accountId);
  }

  async checkNicknameAvailability(
    nickname: string,
    accountId: bigint,
  ): Promise<NicknameAvailability> {
    await this.requireActiveUser(accountId);

    const trimmed = nickname.trim();

    if (
      trimmed.length < MIN_NICKNAME_LENGTH ||
      trimmed.length > MAX_NICKNAME_LENGTH
    ) {
      return {
        available: false,
        reason: `닉네임은 ${MIN_NICKNAME_LENGTH}~${MAX_NICKNAME_LENGTH}자여야 합니다.`,
      };
    }

    const nicknameRegex = /^[A-Za-z0-9가-힣_]+$/;
    if (!nicknameRegex.test(trimmed)) {
      return {
        available: false,
        reason: '닉네임은 한글, 영문, 숫자, 언더스코어만 사용할 수 있습니다.',
      };
    }

    const isTaken = await this.accounts.isNicknameTaken(trimmed, accountId);
    if (isTaken) {
      return { available: false, reason: '이미 사용 중인 닉네임입니다.' };
    }

    return { available: true, reason: null };
  }

  async createProfileImageUploadUrl(
    accountId: bigint,
    input: { contentType: string; contentLength: number },
  ): Promise<CreateUploadUrlOutput> {
    await this.requireActiveUser(accountId);

    return this.s3Service.createUploadUrl({
      accountId,
      purpose: 'PROFILE_IMAGE',
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  }

  async deleteMyAccount(accountId: bigint): Promise<boolean> {
    await this.requireActiveUser(accountId);

    const now = new Date();
    const deletedNickname = `deleted_${accountId.toString()}`;

    await this.accounts.softDeleteAccount({
      accountId,
      deletedNickname,
      now,
    });
    // 커밋 뒤 — 세션은 tx에서 끊겼고, 만료 전 액세스 토큰은 여기서 막는다
    await this.blacklist.blockStatus(accountId, 'DELETED');

    return true;
  }
}
