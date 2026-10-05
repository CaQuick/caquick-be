import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { SellerRegisterPushTokenInput } from '@/features/notification/dto/inputs/seller-register-push-token.input';
import { SellerUnregisterPushTokenInput } from '@/features/notification/dto/inputs/seller-unregister-push-token.input';
import { SellerPushDeviceService } from '@/features/notification/services/seller-push-device.service';
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
@Roles('SELLER')
export class SellerPushDeviceMutationResolver {
  constructor(private readonly service: SellerPushDeviceService) {}

  @Mutation('sellerRegisterPushToken')
  sellerRegisterPushToken(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerRegisterPushTokenInput,
  ): Promise<boolean> {
    return this.service.register(parseAccountId(user), input);
  }

  @Mutation('sellerUnregisterPushToken')
  sellerUnregisterPushToken(
    @CurrentUser() user: JwtUser,
    @Args('input') input: SellerUnregisterPushTokenInput,
  ): Promise<boolean> {
    return this.service.unregister(parseAccountId(user), input);
  }
}
