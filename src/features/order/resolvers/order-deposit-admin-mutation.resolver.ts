import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminConfirmPaymentInput } from '@/features/order/dto/inputs/admin-confirm-payment.input';
import { AdminDepositService } from '@/features/order/services/order-deposit-admin.service';
import type { AdminOrderSummaryOutput } from '@/features/order/types/order-admin-output.type';
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
export class AdminDepositMutationResolver {
  constructor(private readonly depositService: AdminDepositService) {}

  @Mutation('adminConfirmPayment')
  adminConfirmPayment(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminConfirmPaymentInput,
  ): Promise<AdminOrderSummaryOutput> {
    return this.depositService.adminConfirmPayment(parseAccountId(user), input);
  }
}
