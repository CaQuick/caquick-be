import { BadRequestException, UseGuards } from '@nestjs/common';
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

/**
 * 일반 유저 Mutation 리졸버
 */
@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserMutationResolver {
  constructor(private readonly userService: UserService) {}

  @Mutation('completeOnboarding')
  completeOnboarding(
    @CurrentUser() user: JwtUser,
    @Args('input') input: CompleteOnboardingInput,
  ): Promise<MePayload> {
    const accountId = this.parseAccountId(user);
    return this.userService.completeOnboarding(accountId, input);
  }

  @Mutation('updateMyProfile')
  updateMyProfile(
    @CurrentUser() user: JwtUser,
    @Args('input') input: UpdateMyProfileInput,
  ): Promise<MePayload> {
    const accountId = this.parseAccountId(user);
    return this.userService.updateMyProfile(accountId, input);
  }

  @Mutation('updateMyProfileImage')
  updateMyProfileImage(
    @CurrentUser() user: JwtUser,
    @Args('input') input: UpdateMyProfileImageInput,
  ): Promise<MePayload> {
    const accountId = this.parseAccountId(user);
    return this.userService.updateMyProfileImage(accountId, input);
  }

  @Mutation('deleteMyAccount')
  deleteMyAccount(@CurrentUser() user: JwtUser): Promise<boolean> {
    const accountId = this.parseAccountId(user);
    return this.userService.deleteMyAccount(accountId);
  }

  @Mutation('markNotificationRead')
  markNotificationRead(
    @CurrentUser() user: JwtUser,
    @Args('notificationId') notificationId: string,
  ): Promise<boolean> {
    const accountId = this.parseAccountId(user);
    const id = this.parseId(notificationId);
    return this.userService.markNotificationRead(accountId, id);
  }

  @Mutation('markAllNotificationsRead')
  markAllNotificationsRead(@CurrentUser() user: JwtUser): Promise<boolean> {
    const accountId = this.parseAccountId(user);
    return this.userService.markAllNotificationsRead(accountId);
  }

  @Mutation('deleteSearchHistory')
  deleteSearchHistory(
    @CurrentUser() user: JwtUser,
    @Args('id') id: string,
  ): Promise<boolean> {
    const accountId = this.parseAccountId(user);
    const parsedId = this.parseId(id);
    return this.userService.deleteSearchHistory(accountId, parsedId);
  }

  @Mutation('clearSearchHistories')
  clearSearchHistories(@CurrentUser() user: JwtUser): Promise<boolean> {
    const accountId = this.parseAccountId(user);
    return this.userService.clearSearchHistories(accountId);
  }

  private parseAccountId(user: JwtUser): bigint {
    try {
      return BigInt(user.accountId);
    } catch {
      throw new BadRequestException('Invalid account id.');
    }
  }

  private parseId(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new BadRequestException('Invalid id.');
    }
  }
}
