import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';

import { AdminSearchKeywordChipService } from '@/features/search/services/search-admin.service';
import type { AdminSearchKeywordChipOutput } from '@/features/search/types/search-admin-output.type';
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
export class AdminSearchKeywordChipQueryResolver {
  constructor(private readonly chipService: AdminSearchKeywordChipService) {}

  @Query('adminSearchKeywordChips')
  adminSearchKeywordChips(
    @CurrentUser() user: JwtUser,
  ): Promise<AdminSearchKeywordChipOutput[]> {
    return this.chipService.adminSearchKeywordChips(parseAccountId(user));
  }
}
