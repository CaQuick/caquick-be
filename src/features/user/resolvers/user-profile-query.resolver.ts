import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard } from '../../../global/auth';
import type { JwtUser } from '../../../global/auth';
import type { MePayload } from '../types/user-output.type';
import { UserService } from '../user.service';

import { parseAccountId } from './user-resolver.utils';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserProfileQueryResolver {
  constructor(private readonly userService: UserService) {}

  @Query('me')
  me(@CurrentUser() user: JwtUser): Promise<MePayload> {
    const accountId = parseAccountId(user);
    return this.userService.me(accountId);
  }
}
