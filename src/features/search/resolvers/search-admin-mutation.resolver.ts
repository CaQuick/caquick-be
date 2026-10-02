import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { AdminCreateSearchKeywordChipInput } from '@/features/search/dto/inputs/admin-create-search-keyword-chip.input';
import { AdminReorderSearchKeywordChipsInput } from '@/features/search/dto/inputs/admin-reorder-search-keyword-chips.input';
import { AdminUpdateSearchKeywordChipInput } from '@/features/search/dto/inputs/admin-update-search-keyword-chip.input';
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

@Resolver('Mutation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminSearchKeywordChipMutationResolver {
  constructor(private readonly chipService: AdminSearchKeywordChipService) {}

  @Mutation('adminCreateSearchKeywordChip')
  adminCreateSearchKeywordChip(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCreateSearchKeywordChipInput,
  ): Promise<AdminSearchKeywordChipOutput> {
    return this.chipService.adminCreateSearchKeywordChip(
      parseAccountId(user),
      input,
    );
  }

  @Mutation('adminUpdateSearchKeywordChip')
  adminUpdateSearchKeywordChip(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminUpdateSearchKeywordChipInput,
  ): Promise<AdminSearchKeywordChipOutput> {
    return this.chipService.adminUpdateSearchKeywordChip(
      parseAccountId(user),
      input,
    );
  }

  @Mutation('adminDeleteSearchKeywordChip')
  adminDeleteSearchKeywordChip(
    @CurrentUser() user: JwtUser,
    @Args('chipId') chipId: string,
  ): Promise<boolean> {
    return this.chipService.adminDeleteSearchKeywordChip(
      parseAccountId(user),
      parseId(chipId),
    );
  }

  @Mutation('adminReorderSearchKeywordChips')
  adminReorderSearchKeywordChips(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminReorderSearchKeywordChipsInput,
  ): Promise<AdminSearchKeywordChipOutput[]> {
    return this.chipService.adminReorderSearchKeywordChips(
      parseAccountId(user),
      input,
    );
  }
}
