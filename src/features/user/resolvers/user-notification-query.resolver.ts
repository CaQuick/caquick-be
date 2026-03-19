import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard } from '../../../global/auth';
import type { JwtUser } from '../../../global/auth';
import { UserNotificationService } from '../services/user-notification.service';
import type { MyNotificationsInput } from '../types/user-input.type';
import type {
  NotificationConnection,
  ViewerCounts,
} from '../types/user-output.type';

import { parseAccountId } from './user-resolver.utils';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserNotificationQueryResolver {
  constructor(private readonly notificationService: UserNotificationService) {}

  @Query('viewerCounts')
  viewerCounts(@CurrentUser() user: JwtUser): Promise<ViewerCounts> {
    const accountId = parseAccountId(user);
    return this.notificationService.viewerCounts(accountId);
  }

  @Query('myNotifications')
  myNotifications(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: MyNotificationsInput,
  ): Promise<NotificationConnection> {
    const accountId = parseAccountId(user);
    return this.notificationService.myNotifications(accountId, input);
  }
}
