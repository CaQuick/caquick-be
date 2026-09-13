import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { AdminCreateCategoryInput } from '@/features/admin/dto/inputs/admin-create-category.input';
import { AdminCreateTagInput } from '@/features/admin/dto/inputs/admin-create-tag.input';
import { AdminUpdateCategoryInput } from '@/features/admin/dto/inputs/admin-update-category.input';
import { AdminUpdateTagInput } from '@/features/admin/dto/inputs/admin-update-tag.input';
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

@Resolver('Mutation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminTaxonomyMutationResolver {
  constructor(private readonly taxonomyService: AdminTaxonomyService) {}

  @Mutation('adminCreateCategory')
  adminCreateCategory(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCreateCategoryInput,
  ): Promise<AdminCategoryOutput> {
    return this.taxonomyService.adminCreateCategory(
      parseAccountId(user),
      input,
    );
  }

  @Mutation('adminUpdateCategory')
  adminUpdateCategory(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminUpdateCategoryInput,
  ): Promise<AdminCategoryOutput> {
    return this.taxonomyService.adminUpdateCategory(
      parseAccountId(user),
      input,
    );
  }

  @Mutation('adminDeleteCategory')
  adminDeleteCategory(
    @CurrentUser() user: JwtUser,
    @Args('categoryId') categoryId: string,
  ): Promise<boolean> {
    return this.taxonomyService.adminDeleteCategory(
      parseAccountId(user),
      parseId(categoryId),
    );
  }

  @Mutation('adminCreateTag')
  adminCreateTag(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCreateTagInput,
  ): Promise<AdminTagOutput> {
    return this.taxonomyService.adminCreateTag(parseAccountId(user), input);
  }

  @Mutation('adminUpdateTag')
  adminUpdateTag(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminUpdateTagInput,
  ): Promise<AdminTagOutput> {
    return this.taxonomyService.adminUpdateTag(parseAccountId(user), input);
  }

  @Mutation('adminDeleteTag')
  adminDeleteTag(
    @CurrentUser() user: JwtUser,
    @Args('tagId') tagId: string,
  ): Promise<boolean> {
    return this.taxonomyService.adminDeleteTag(
      parseAccountId(user),
      parseId(tagId),
    );
  }
}
