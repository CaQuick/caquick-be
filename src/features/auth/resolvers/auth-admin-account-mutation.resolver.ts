import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminCreateAdminInput } from '@/features/auth/dto/inputs/admin-create-admin.input';
import { AdminAccountService } from '@/features/auth/services/auth-admin-account.service';
import type { AdminAccountOutput } from '@/features/auth/types/auth-admin-output.type';
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
export class AdminAccountMutationResolver {
  constructor(private readonly accountService: AdminAccountService) {}

  @Mutation('adminCreateAdmin')
  adminCreateAdmin(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCreateAdminInput,
  ): Promise<AdminAccountOutput> {
    return this.accountService.adminCreateAdmin(parseAccountId(user), input);
  }
}
