import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { AdminMonthlyCommissionInput } from '@/features/order/dto/inputs/admin-monthly-commission.input';
import { AdminSettlementListInput } from '@/features/order/dto/inputs/admin-settlement-list.input';
import { AdminSettlementService } from '@/features/order/services/order-settlement-admin.service';
import type {
  AdminMonthlyCommissionReportOutput,
  AdminSettlementDetailOutput,
  AdminSettlementSummaryOutput,
} from '@/features/order/types/order-settlement-output.type';
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
export class AdminSettlementQueryResolver {
  constructor(private readonly settlementService: AdminSettlementService) {}

  @Query('adminSettlements')
  adminSettlements(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminSettlementListInput,
  ): Promise<CursorConnection<AdminSettlementSummaryOutput>> {
    return this.settlementService.adminSettlements(parseAccountId(user), input);
  }

  @Query('adminSettlement')
  adminSettlement(
    @CurrentUser() user: JwtUser,
    @Args('settlementId') settlementId: string,
  ): Promise<AdminSettlementDetailOutput> {
    return this.settlementService.adminSettlement(
      parseAccountId(user),
      parseId(settlementId),
    );
  }

  @Query('adminMonthlyCommissions')
  adminMonthlyCommissions(
    @CurrentUser() user: JwtUser,
    @Args('input') input: AdminMonthlyCommissionInput,
  ): Promise<AdminMonthlyCommissionReportOutput> {
    return this.settlementService.adminMonthlyCommissions(
      parseAccountId(user),
      input,
    );
  }
}
