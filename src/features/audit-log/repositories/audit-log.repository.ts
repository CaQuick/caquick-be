import { Injectable } from '@nestjs/common';
import {
  type AuditActionType,
  type AuditLog,
  type AuditTargetType,
  Prisma,
} from '@prisma/client';

import type { IAuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository.interface';
import { PrismaService } from '@/prisma';

/**
 * AuditLog Repository 구체 구현.
 *
 * `audit_log` 테이블 write 전용. read 가 필요하면 별도 메서드를 추가한다.
 */
@Injectable()
export class AuditLogRepository implements IAuditLogRepository {
  /**
   * @param prisma PrismaService
   */
  constructor(private readonly prisma: PrismaService) {}

  async createAuditLog(args: {
    actorAccountId: bigint;
    storeId?: bigint | null;
    targetType: AuditTargetType;
    targetId: bigint;
    action: AuditActionType;
    beforeJson?: Prisma.InputJsonValue | null;
    afterJson?: Prisma.InputJsonValue | null;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        actor_account_id: args.actorAccountId,
        store_id: args.storeId ?? null,
        target_type: args.targetType,
        target_id: args.targetId,
        action: args.action,
        before_json:
          args.beforeJson === null ? Prisma.JsonNull : args.beforeJson,
        after_json: args.afterJson === null ? Prisma.JsonNull : args.afterJson,
        ip_address: args.ipAddress ?? null,
        user_agent: args.userAgent ?? null,
      },
    });
  }
}
