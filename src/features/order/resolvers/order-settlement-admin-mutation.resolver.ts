import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AdminMarkSettlementPaidInput } from '@/features/order/dto/inputs/admin-mark-settlement-paid.input';
import { AdminSettlementService } from '@/features/order/services/order-settlement-admin.service';
import type { AdminSettlementDetailOutput } from '@/features/order/types/order-settlement-output.type';
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
export class AdminSettlementMutationResolver {
  constructor(private readonly settlementService: AdminSettlementService) {}

  @Mutation('adminMarkSettlementPaid')
  adminMarkSettlementPaid(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminMarkSettlementPaidInput,
  ): Promise<AdminSettlementDetailOutput> {
    return this.settlementService.adminMarkSettlementPaid(
      parseAccountId(user),
      input,
    );
  }
}
