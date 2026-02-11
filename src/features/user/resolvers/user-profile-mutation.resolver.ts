import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard } from '../../../global/auth';
import type { JwtUser } from '../../../global/auth';
import type {
  CompleteOnboardingInput,
  UpdateMyProfileImageInput,
  UpdateMyProfileInput,
} from '../types/user-input.type';
import type { MePayload } from '../types/user-output.type';
import { UserService } from '../user.service';

import { parseAccountId } from './user-resolver.utils';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserProfileMutationResolver {
  constructor(private readonly userService: UserService) {}

  @Mutation('completeOnboarding')
  completeOnboarding(
    @CurrentUser() user: JwtUser,
    @Args('input') input: CompleteOnboardingInput,
  ): Promise<MePayload> {
    const accountId = parseAccountId(user);
    return this.userService.completeOnboarding(accountId, input);
  }

  @Mutation('updateMyProfile')
  updateMyProfile(
    @CurrentUser() user: JwtUser,
    @Args('input') input: UpdateMyProfileInput,
  ): Promise<MePayload> {
    const accountId = parseAccountId(user);
    return this.userService.updateMyProfile(accountId, input);
  }

  @Mutation('updateMyProfileImage')
  updateMyProfileImage(
    @CurrentUser() user: JwtUser,
    @Args('input') input: UpdateMyProfileImageInput,
  ): Promise<MePayload> {
    const accountId = parseAccountId(user);
    return this.userService.updateMyProfileImage(accountId, input);
  }

  @Mutation('deleteMyAccount')
  deleteMyAccount(@CurrentUser() user: JwtUser): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.userService.deleteMyAccount(accountId);
  }
}
