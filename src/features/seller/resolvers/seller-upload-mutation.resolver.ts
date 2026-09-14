import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { SellerCreateUploadUrlInput } from '@/features/seller/dto/inputs/seller-create-upload-url.input';
import { SellerUploadService } from '@/features/seller/services/seller-upload.service';
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
@Roles('SELLER')
export class SellerUploadMutationResolver {
  constructor(private readonly uploadService: SellerUploadService) {}

  @Mutation('sellerCreateUploadUrl')
  sellerCreateUploadUrl(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerCreateUploadUrlInput,
  ): Promise<CreateUploadUrlOutput> {
    return this.uploadService.sellerCreateUploadUrl(
      parseAccountId(user),
      input,
    );
  }
}
