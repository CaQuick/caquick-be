import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { AdminNotificationBroadcastListInput } from '@/features/notification/dto/inputs/admin-notification-broadcast-list.input';
import { AdminNotificationService } from '@/features/notification/services/notification-admin.service';
import type { AdminNotificationBroadcastOutput } from '@/features/notification/types/notification-admin-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Query')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminNotificationQueryResolver {
  constructor(private readonly notificationService: AdminNotificationService) {}

  @Query('adminNotificationBroadcasts')
  adminNotificationBroadcasts(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true })
    input?: AdminNotificationBroadcastListInput,
  ): Promise<CursorConnection<AdminNotificationBroadcastOutput>> {
    return this.notificationService.adminNotificationBroadcasts(
      parseAccountId(user),
      input,
    );
  }
}
