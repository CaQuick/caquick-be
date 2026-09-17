import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { AdminAccountService } from '@/features/admin/services/admin-account.service';
import type { AdminAccountOutput } from '@/features/admin/types/admin-output.type';
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
export class AdminAccountQueryResolver {
  constructor(private readonly accountService: AdminAccountService) {}

  @Query('adminMe')
  adminMe(@CurrentUser() user: JwtUser): Promise<AdminAccountOutput> {
    return this.accountService.adminMe(parseAccountId(user));
  }

  @Query('adminAdmins')
  adminAdmins(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: CursorInput,
  ): Promise<CursorConnection<AdminAccountOutput>> {
    return this.accountService.adminAdmins(parseAccountId(user), input);
  }
}
