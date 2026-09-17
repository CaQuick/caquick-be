import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { AdminCategoryListInput } from '@/features/admin/dto/inputs/admin-category-list.input';
import { AdminTagListInput } from '@/features/admin/dto/inputs/admin-tag-list.input';
import { AdminTaxonomyService } from '@/features/admin/services/admin-taxonomy.service';
import type {
  AdminCategoryOutput,
  AdminTagOutput,
} from '@/features/admin/types/admin-output.type';
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
export class AdminTaxonomyQueryResolver {
  constructor(private readonly taxonomyService: AdminTaxonomyService) {}

  @Query('adminCategories')
  adminCategories(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminCategoryListInput,
  ): Promise<AdminCategoryOutput[]> {
    return this.taxonomyService.adminCategories(parseAccountId(user), input);
  }

  @Query('adminTags')
  adminTags(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminTagListInput,
  ): Promise<CursorConnection<AdminTagOutput>> {
    return this.taxonomyService.adminTags(parseAccountId(user), input);
  }
}
