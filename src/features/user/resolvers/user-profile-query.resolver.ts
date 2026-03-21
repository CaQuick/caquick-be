import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';

import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '../../../global/auth';
import { UserProfileService } from '../services/user-profile.service';
import type { MePayload } from '../types/user-output.type';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserProfileQueryResolver {
  constructor(private readonly profileService: UserProfileService) {}

  @Query('me')
  me(@CurrentUser() user: JwtUser): Promise<MePayload> {
    const accountId = parseAccountId(user);
    return this.profileService.me(accountId);
  }
}
