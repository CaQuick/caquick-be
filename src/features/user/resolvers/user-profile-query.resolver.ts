import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { UserProfileService } from '@/features/user/services/user-profile.service';
import type {
  MePayload,
  NicknameAvailability,
} from '@/features/user/types/user-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserProfileQueryResolver {
  constructor(private readonly profileService: UserProfileService) {}

  @Query('me')
  me(@CurrentUser() user: JwtUser): Promise<MePayload> {
    const accountId = parseAccountId(user);
    return this.profileService.me(accountId);
  }

  @Query('checkNicknameAvailability')
  checkNicknameAvailability(
    @CurrentUser() user: JwtUser,
    @Args('nickname') nickname: string,
  ): Promise<NicknameAvailability> {
    const accountId = parseAccountId(user);
    return this.profileService.checkNicknameAvailability(nickname, accountId);
  }
}
