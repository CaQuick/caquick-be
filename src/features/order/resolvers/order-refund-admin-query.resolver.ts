import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { AdminDepositRecordListInput } from '@/features/order/dto/inputs/admin-deposit-record-list.input';
import { AdminRefundListInput } from '@/features/order/dto/inputs/admin-refund-list.input';
import { AdminRefundService } from '@/features/order/services/order-refund-admin.service';
import type {
  AdminDepositRecordOutput,
  AdminRefundDetailOutput,
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

@Resolver('Query')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminRefundQueryResolver {
  constructor(private readonly refundService: AdminRefundService) {}

  @Query('adminRefunds')
  adminRefunds(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminRefundListInput,
  ): Promise<CursorConnection<AdminRefundOutput>> {
    return this.refundService.adminRefunds(parseAccountId(user), input);
  }

  @Query('adminRefund')
  adminRefund(
    @CurrentUser() user: JwtUser,
    @Args('refundId') refundId: string,
  ): Promise<AdminRefundDetailOutput> {
    return this.refundService.adminRefund(
      parseAccountId(user),
      parseId(refundId),
    );
  }

  @Query('adminDepositRecords')
  adminDepositRecords(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminDepositRecordListInput,
  ): Promise<CursorConnection<AdminDepositRecordOutput>> {
    return this.refundService.adminDepositRecords(parseAccountId(user), input);
  }
}
