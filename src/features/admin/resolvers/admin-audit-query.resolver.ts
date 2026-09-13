import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { AdminAuditLogListInput } from '@/features/admin/dto/inputs/admin-audit-log-list.input';
import { AdminAuditService } from '@/features/admin/services/admin-audit.service';
import type {
  AdminAuditLogOutput,
  AdminCursorConnection,
} from '@/features/admin/types/admin-output.type';
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
  ): Promise<AdminCursorConnection<AdminAuditLogOutput>> {
    return this.auditService.adminAuditLogs(parseAccountId(user), input);
  }
}
