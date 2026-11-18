import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminUpdatePaymentSettingInput } from '@/features/order/dto/inputs/admin-update-payment-setting.input';
import { AdminUpsertStoreSettlementAccountInput } from '@/features/order/dto/inputs/admin-upsert-store-settlement-account.input';
import { AdminPaymentService } from '@/features/order/services/order-payment-admin.service';
import type {
  AdminPaymentSettingOutput,
  AdminStoreSettlementAccountOutput,
} from '@/features/order/types/order-payment-output.type';
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
export class AdminPaymentMutationResolver {
  constructor(private readonly paymentService: AdminPaymentService) {}

  @Mutation('adminUpdatePaymentSetting')
  adminUpdatePaymentSetting(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminUpdatePaymentSettingInput,
  ): Promise<AdminPaymentSettingOutput> {
    return this.paymentService.adminUpdatePaymentSetting(
      parseAccountId(user),
      input,
    );
  }

  @Mutation('adminUpsertStoreSettlementAccount')
  adminUpsertStoreSettlementAccount(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminUpsertStoreSettlementAccountInput,
  ): Promise<AdminStoreSettlementAccountOutput> {
    return this.paymentService.adminUpsertStoreSettlementAccount(
      parseAccountId(user),
      input,
    );
  }
}
