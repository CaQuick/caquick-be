import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { AdminPendingPaymentListInput } from '@/features/order/dto/inputs/admin-pending-payment-list.input';
import { AdminDepositService } from '@/features/order/services/order-deposit-admin.service';
import type {
  AdminPendingPaymentOutput,
  AdminTaskCountsOutput,
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
export class AdminDepositQueryResolver {
  constructor(private readonly depositService: AdminDepositService) {}

  @Query('adminPendingPayments')
  adminPendingPayments(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminPendingPaymentListInput,
  ): Promise<CursorConnection<AdminPendingPaymentOutput>> {
    return this.depositService.adminPendingPayments(
      parseAccountId(user),
      input,
    );
  }

  @Query('adminTaskCounts')
  adminTaskCounts(
    @CurrentUser() user: JwtUser,
  ): Promise<AdminTaskCountsOutput> {
    return this.depositService.adminTaskCounts(parseAccountId(user));
  }
}
