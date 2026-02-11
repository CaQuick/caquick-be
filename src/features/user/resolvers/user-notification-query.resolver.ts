import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CurrentUser, JwtAuthGuard } from '../../../global/auth';
import type { JwtUser } from '../../../global/auth';
import type { MyNotificationsInput } from '../types/user-input.type';
import type {
  NotificationConnection,
  ViewerCounts,
} from '../types/user-output.type';
import { UserService } from '../user.service';

import { parseAccountId } from './user-resolver.utils';

@Resolver('Query')
@UseGuards(JwtAuthGuard)
export class UserNotificationQueryResolver {
  constructor(private readonly userService: UserService) {}

  @Query('viewerCounts')
  viewerCounts(@CurrentUser() user: JwtUser): Promise<ViewerCounts> {
    const accountId = parseAccountId(user);
    return this.userService.viewerCounts(accountId);
  }

  @Query('myNotifications')
  myNotifications(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: MyNotificationsInput,
  ): Promise<NotificationConnection> {
    const accountId = parseAccountId(user);
    return this.userService.myNotifications(accountId, input);
  }
}
