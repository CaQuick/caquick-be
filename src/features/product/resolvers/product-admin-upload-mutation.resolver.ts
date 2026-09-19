import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminCreateUploadUrlInput } from '@/features/product/dto/inputs/admin-create-upload-url.input';
import { AdminUploadService } from '@/features/product/services/product-admin-upload.service';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  parseAccountId,
  type JwtUser,
} from '@/global/auth';
import type { CreateUploadUrlOutput } from '@/global/storage/types/storage.types';

@Resolver('Mutation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminUploadMutationResolver {
  constructor(private readonly uploadService: AdminUploadService) {}

  @Mutation('adminCreateUploadUrl')
  adminCreateUploadUrl(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCreateUploadUrlInput,
  ): Promise<CreateUploadUrlOutput> {
    return this.uploadService.adminCreateUploadUrl(parseAccountId(user), input);
  }
}
