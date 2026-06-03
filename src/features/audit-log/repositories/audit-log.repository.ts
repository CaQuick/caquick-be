import { Injectable } from '@nestjs/common';
import {
  type AuditActionType,
  type AuditLog,
  type AuditTargetType,
  Prisma,
} from '@prisma/client';

import type { IAuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository.interface';
import { RequestContextService } from '@/global/request-context';
import { PrismaService } from '@/prisma';

/**
 * AuditLog Repository 구체 구현.
 *
 * `audit_log` 테이블 write 전용. read 가 필요하면 별도 메서드를 추가한다.
 *
 * ip/ua 는 단일 write 진입점에서 요청 컨텍스트(ALS)로부터 자동 보강한다 —
 * 도메인 서비스가 transport 메타데이터를 인자로 들고 다니지 않게 한다.
 * 명시적으로 전달된 `args.ipAddress`/`args.userAgent` 가 있으면 그쪽이 우선한다.
 */
@Injectable()
export class AuditLogRepository implements IAuditLogRepository {
  /**
   * @param prisma PrismaService
   * @param requestContext 요청 컨텍스트(ALS) — ip/ua 자동 보강용
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

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
    const ctx = this.requestContext.get();
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
        ip_address: args.ipAddress ?? ctx?.clientIp ?? null,
        user_agent: args.userAgent ?? ctx?.userAgent ?? null,
      },
    });
  }
}
