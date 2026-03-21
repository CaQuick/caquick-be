import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { UserNotificationService } from '@/features/user/services/user-notification.service';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard)
export class UserNotificationMutationResolver {
  constructor(private readonly notificationService: UserNotificationService) {}

  @Mutation('markNotificationRead')
  markNotificationRead(
    @CurrentUser() user: JwtUser,
    @Args('notificationId') notificationId: string,
  ): Promise<boolean> {
    const accountId = parseAccountId(user);
    const id = parseId(notificationId);
    return this.notificationService.markNotificationRead(accountId, id);
  }

  @Mutation('markAllNotificationsRead')
  markAllNotificationsRead(@CurrentUser() user: JwtUser): Promise<boolean> {
    const accountId = parseAccountId(user);
    return this.notificationService.markAllNotificationsRead(accountId);
  }
}
