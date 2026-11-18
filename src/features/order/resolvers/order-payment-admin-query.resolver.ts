import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
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

@Resolver('Query')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminPaymentQueryResolver {
  constructor(private readonly paymentService: AdminPaymentService) {}

  @Query('adminPaymentSetting')
  adminPaymentSetting(
    @CurrentUser() user: JwtUser,
  ): Promise<AdminPaymentSettingOutput> {
    return this.paymentService.adminPaymentSetting(parseAccountId(user));
  }

  @Query('adminStoreSettlementAccount')
  adminStoreSettlementAccount(
    @CurrentUser() user: JwtUser,
    @Args('storeId') storeId: string,
  ): Promise<AdminStoreSettlementAccountOutput | null> {
    return this.paymentService.adminStoreSettlementAccount(
      parseAccountId(user),
      parseId(storeId),
    );
  }
}
