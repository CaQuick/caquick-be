import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { UserProfileService } from '@/features/user/services/user-profile.service';
import type {
  CompleteOnboardingInput,
  UpdateMyProfileImageInput,
  UpdateMyProfileInput,
} from '@/features/user/types/user-input.type';
import type {
  MePayload,
  ProfileImageUploadUrl,
} from '@/features/user/types/user-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserProfileMutationResolver {
  constructor(private readonly profileService: UserProfileService) {}

  @Mutation('completeOnboarding')
  completeOnboarding(
    @CurrentUser() user: JwtUser,
    @Args('input') input: CompleteOnboardingInput,
  ): Promise<MePayload> {
    const accountId = parseAccountId(user);
    return this.profileService.completeOnboarding(accountId, input);
  }

  @Mutation('updateMyProfile')
  updateMyProfile(
    @CurrentUser() user: JwtUser,
    @Args('input') input: UpdateMyProfileInput,
  ): Promise<MePayload> {
    const accountId = parseAccountId(user);
    return this.profileService.updateMyProfile(accountId, input);
  }

  @Mutation('updateMyProfileImage')
  updateMyProfileImage(
    @CurrentUser() user: JwtUser,
    @Args('input') input: UpdateMyProfileImageInput,
  ): Promise<MePayload> {
    const accountId = parseAccountId(user);
    return this.profileService.updateMyProfileImage(accountId, input);
  }

  @Mutation('createProfileImageUploadUrl')
  createProfileImageUploadUrl(
    @CurrentUser() user: JwtUser,
    @Args('input') input: { contentType: string; contentLength: number },
  ): Promise<ProfileImageUploadUrl> {
    const accountId = parseAccountId(user);
    return this.profileService.createProfileImageUploadUrl(accountId, input);
  }

  @Mutation('deleteMyAccount')
  deleteMyAccount(@CurrentUser() user: JwtUser): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.profileService.deleteMyAccount(accountId);
  }
}
