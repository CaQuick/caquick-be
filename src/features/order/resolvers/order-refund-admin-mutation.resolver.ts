import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminCompleteRefundInput } from '@/features/order/dto/inputs/admin-complete-refund.input';
import { AdminCreateDepositReturnInput } from '@/features/order/dto/inputs/admin-create-deposit-return.input';
import { AdminLinkUnidentifiedDepositInput } from '@/features/order/dto/inputs/admin-link-unidentified-deposit.input';
import { AdminRecordUnidentifiedDepositInput } from '@/features/order/dto/inputs/admin-record-unidentified-deposit.input';
import { AdminRefundService } from '@/features/order/services/order-refund-admin.service';
import type {
  AdminDepositRecordOutput,
  AdminRefundOutput,
} from '@/features/order/types/order-refund-output.type';
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
export class AdminRefundMutationResolver {
  constructor(private readonly refundService: AdminRefundService) {}

  @Mutation('adminCompleteRefund')
  adminCompleteRefund(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCompleteRefundInput,
  ): Promise<AdminRefundOutput> {
    return this.refundService.adminCompleteRefund(parseAccountId(user), input);
  }

  @Mutation('adminCreateDepositReturn')
  adminCreateDepositReturn(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminCreateDepositReturnInput,
  ): Promise<AdminDepositRecordOutput> {
    return this.refundService.adminCreateDepositReturn(
      parseAccountId(user),
      input,
    );
  }

  @Mutation('adminRecordUnidentifiedDeposit')
  adminRecordUnidentifiedDeposit(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminRecordUnidentifiedDepositInput,
  ): Promise<AdminDepositRecordOutput> {
    return this.refundService.adminRecordUnidentifiedDeposit(
      parseAccountId(user),
      input,
    );
  }

  @Mutation('adminLinkUnidentifiedDeposit')
  adminLinkUnidentifiedDeposit(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminLinkUnidentifiedDepositInput,
  ): Promise<AdminDepositRecordOutput> {
    return this.refundService.adminLinkUnidentifiedDeposit(
      parseAccountId(user),
      input,
    );
  }
}
