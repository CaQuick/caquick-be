import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard } from '../../../global/auth';
import type { JwtUser } from '../../../global/auth';
import { UserService } from '../user.service';

import { parseAccountId, parseId } from './user-resolver.utils';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserNotificationMutationResolver {
  constructor(private readonly userService: UserService) {}

  @Mutation('markNotificationRead')
  markNotificationRead(
    @CurrentUser() user: JwtUser,
    @Args('notificationId') notificationId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    const id = parseId(notificationId);
    return this.userService.markNotificationRead(accountId, id);
  }

  @Mutation('markAllNotificationsRead')
  markAllNotificationsRead(@CurrentUser() user: JwtUser): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.userService.markAllNotificationsRead(accountId);
  }
}
