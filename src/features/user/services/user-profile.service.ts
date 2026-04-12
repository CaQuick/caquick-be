import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';

import {
  MAX_NICKNAME_LENGTH,
  MIN_NICKNAME_LENGTH,
} from '@/features/user/constants/user.constants';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserBaseService } from '@/features/user/services/user-base.service';
import type {
  CompleteOnboardingInput,
  UpdateMyProfileImageInput,
  UpdateMyProfileInput,
} from '@/features/user/types/user-input.type';
import type {
  MePayload,
  NicknameAvailability,
  ProfileImageUploadUrl,
} from '@/features/user/types/user-output.type';
import { S3Service } from '@/global/storage/s3.service';

@Injectable()
export class UserProfileService extends UserBaseService {
  constructor(
    repo: UserRepository,
    private readonly s3Service: S3Service,
  ) {
    super(repo);
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
      throw new BadRequestException('Name is required.');
    }

    const isTaken = await this.repo.isNicknameTaken(nickname, accountId);
    if (isTaken) throw new ConflictException('Nickname already exists.');

    await this.repo.completeOnboarding({
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
    const hasBirthDate = input.birthDate !== undefined;
    const hasPhoneNumber = input.phoneNumber !== undefined;

    if (!hasNickname && !hasBirthDate && !hasPhoneNumber) {
      throw new BadRequestException('No fields to update.');
    }

    const nickname = hasNickname
      ? this.normalizeNickname(input.nickname ?? '')
      : undefined;

    if (nickname) {
      const isTaken = await this.repo.isNicknameTaken(nickname, accountId);
      if (isTaken) throw new ConflictException('Nickname already exists.');
    }

    const birthDate = hasBirthDate
      ? this.normalizeBirthDate(input.birthDate)
      : undefined;
    const phoneNumber = hasPhoneNumber
      ? this.normalizePhoneNumber(input.phoneNumber)
      : undefined;

    await this.repo.updateProfile({
      accountId,
      ...(hasNickname ? { nickname } : {}),
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

    const profileImageUrl = input.profileImageUrl.trim();
    if (profileImageUrl.length === 0) {
      throw new BadRequestException('profileImageUrl is required.');
    }
    if (profileImageUrl.length > 2048) {
      throw new BadRequestException('profileImageUrl is too long.');
    }

    await this.repo.updateProfileImage({
      accountId,
      profileImageUrl,
    });

    return this.me(accountId);
  }

  async checkNicknameAvailability(
    nickname: string,
    accountId: bigint,
  ): Promise<NicknameAvailability> {
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

    const isTaken = await this.repo.isNicknameTaken(trimmed, accountId);
    if (isTaken) {
      return { available: false, reason: '이미 사용 중인 닉네임입니다.' };
    }

    return { available: true, reason: null };
  }

  async createProfileImageUploadUrl(
    accountId: bigint,
    input: { contentType: string; contentLength: number },
  ): Promise<ProfileImageUploadUrl> {
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

    await this.repo.softDeleteAccount({
      accountId,
      deletedNickname,
      now,
    });

    return true;
  }
}
