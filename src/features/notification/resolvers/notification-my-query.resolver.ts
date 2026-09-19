import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { MyNotificationsInput } from '@/features/notification/dto/inputs/my-notifications.input';
import { UserNotificationService } from '@/features/notification/services/notification-my.service';
import type { NotificationConnection } from '@/features/notification/types/notification-my-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserNotificationQueryResolver {
  constructor(private readonly notificationService: UserNotificationService) {}

  @Query('myNotifications')
  myNotifications(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: MyNotificationsInput,
  ): Promise<NotificationConnection> {
    const accountId = parseAccountId(user);
    return this.notificationService.myNotifications(accountId, input);
  }
}
