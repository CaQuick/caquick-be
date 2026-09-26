import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminSendNotificationInput } from '@/features/notification/dto/inputs/admin-send-notification.input';
import { AdminNotificationService } from '@/features/notification/services/notification-admin.service';
import type { AdminSendNotificationResultOutput } from '@/features/notification/types/notification-admin-output.type';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminNotificationMutationResolver {
  constructor(private readonly notificationService: AdminNotificationService) {}

  @Mutation('adminSendNotification')
  adminSendNotification(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminSendNotificationInput,
  ): Promise<AdminSendNotificationResultOutput> {
    return this.notificationService.adminSendNotification(
      parseAccountId(user),
      input,
    );
  }
}
