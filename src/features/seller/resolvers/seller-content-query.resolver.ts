import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { SellerAuditLogListInput } from '@/features/seller/dto/inputs/seller-audit-log-list.input';
import { SellerAuditService } from '@/features/seller/services/seller-audit.service';
import type { SellerAuditLogOutput } from '@/features/seller/types/seller-output.type';
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
@Roles('SELLER')
export class SellerContentQueryResolver {
  constructor(private readonly auditService: SellerAuditService) {}

  @Query('sellerAuditLogs')
  sellerAuditLogs(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: SellerAuditLogListInput,
  ): Promise<CursorConnection<SellerAuditLogOutput>> {
    const accountId = parseAccountId(user);
    return this.auditService.sellerAuditLogs(accountId, input);
  }
}
