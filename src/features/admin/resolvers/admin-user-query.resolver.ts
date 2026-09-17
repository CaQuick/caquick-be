import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { AdminUserListInput } from '@/features/admin/dto/inputs/admin-user-list.input';
import { AdminUserService } from '@/features/admin/services/admin-user.service';
import type { AdminUserOutput } from '@/features/admin/types/admin-output.type';
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
export class AdminUserQueryResolver {
  constructor(private readonly userService: AdminUserService) {}

  @Query('adminUsers')
  adminUsers(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminUserListInput,
  ): Promise<CursorConnection<AdminUserOutput>> {
    return this.userService.adminUsers(parseAccountId(user), input);
  }

  @Query('adminUser')
  adminUser(
    @CurrentUser() user: JwtUser,
    @Args('accountId') accountId: string,
  ): Promise<AdminUserOutput> {
    return this.userService.adminUser(parseAccountId(user), parseId(accountId));
  }
}
