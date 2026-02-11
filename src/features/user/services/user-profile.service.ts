import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';

import { UserRepository } from '../repositories/user.repository';
import type {
  CompleteOnboardingInput,
  UpdateMyProfileImageInput,
  UpdateMyProfileInput,
} from '../types/user-input.type';
import type { MePayload } from '../types/user-output.type';

import { UserBaseService } from './user-base.service';

@Injectable()
export class UserProfileService extends UserBaseService {
  constructor(repo: UserRepository) {
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
