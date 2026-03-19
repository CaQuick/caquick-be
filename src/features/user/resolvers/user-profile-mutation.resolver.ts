import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard } from '../../../global/auth';
import type { JwtUser } from '../../../global/auth';
import { UserProfileService } from '../services/user-profile.service';
import type {
  CompleteOnboardingInput,
  UpdateMyProfileImageInput,
  UpdateMyProfileInput,
} from '../types/user-input.type';
import type { MePayload } from '../types/user-output.type';

import { parseAccountId } from './user-resolver.utils';

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

  @Mutation('deleteMyAccount')
  deleteMyAccount(@CurrentUser() user: JwtUser): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.profileService.deleteMyAccount(accountId);
  }
}
