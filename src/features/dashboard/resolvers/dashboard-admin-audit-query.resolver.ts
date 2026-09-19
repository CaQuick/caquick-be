import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { AdminAuditLogListInput } from '@/features/dashboard/dto/inputs/admin-audit-log-list.input';
import { AdminAuditService } from '@/features/dashboard/services/dashboard-admin-audit.service';
import type { AdminAuditLogOutput } from '@/features/dashboard/types/dashboard-admin-output.type';
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
export class AdminAuditQueryResolver {
  constructor(private readonly auditService: AdminAuditService) {}

  @Query('adminAuditLogs')
  adminAuditLogs(
    @CurrentUser() user: JwtUser,
    @Args('input', { nullable: true }) input?: AdminAuditLogListInput,
  ): Promise<CursorConnection<AdminAuditLogOutput>> {
    return this.auditService.adminAuditLogs(parseAccountId(user), input);
  }
}
