import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { AdminSuspendAccountInput } from '@/features/admin/dto/inputs/admin-suspend-account.input';
import { AdminUserService } from '@/features/admin/services/admin-user.service';
import type { AdminAccountStatusResultOutput } from '@/features/admin/types/admin-output.type';
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
export class AdminUserMutationResolver {
  constructor(private readonly userService: AdminUserService) {}

  @Mutation('adminSuspendAccount')
  adminSuspendAccount(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminSuspendAccountInput,
  ): Promise<AdminAccountStatusResultOutput> {
    return this.userService.adminSuspendAccount(parseAccountId(user), input);
  }

  @Mutation('adminReinstateAccount')
  adminReinstateAccount(
    @CurrentUser() user: JwtUser,
    @Args('accountId') accountId: string,
  ): Promise<AdminAccountStatusResultOutput> {
    return this.userService.adminReinstateAccount(
      parseAccountId(user),
      parseId(accountId),
    );
  }
}
