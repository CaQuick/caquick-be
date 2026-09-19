import { isIP } from 'node:net';

import { Injectable } from '@nestjs/common';

import { SELLER_AUDIT_TARGET_TYPES } from '@/features/audit-log/constants/audit-log.constants';
import type {
  IAuditLogRepository,
  SellerAuditLogScope,
} from '@/features/audit-log/repositories/audit-log.repository.interface';
import {
  type AuditActionType,
  type AuditLog,
  type AuditTargetType,
  Prisma,
} from '@/generated/prisma/client';
import { RequestContextService } from '@/global/request-context';
import { PrismaService } from '@/prisma';

const MAX_USER_AGENT_LENGTH = 512;

/**
 * ip/ua는 단일 write 진입점에서 요청 컨텍스트(ALS)로부터 자동 보강한다 —
 * 도메인 서비스가 transport 메타데이터를 인자로 들고 다니지 않게 한다. 명시 인자가 있으면 그쪽이 우선한다.
 */
@Injectable()
export class AuditLogRepository implements IAuditLogRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async createAuditLog(
    args: {
      actorAccountId: bigint;
      storeId?: bigint | null;
      targetType: AuditTargetType;
      targetId: bigint;
      action: AuditActionType;
      beforeJson?: Prisma.InputJsonValue | null;
      afterJson?: Prisma.InputJsonValue | null;
      ipAddress?: string;
      userAgent?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<AuditLog> {
    const ctx = this.requestContext.get();
    const db = tx ?? this.prisma;
    return db.auditLog.create({
      data: {
        actor_account_id: args.actorAccountId,
        store_id: args.storeId ?? null,
        target_type: args.targetType,
        target_id: args.targetId,
        action: args.action,
        before_json:
          args.beforeJson === null ? Prisma.JsonNull : args.beforeJson,
        after_json: args.afterJson === null ? Prisma.JsonNull : args.afterJson,
        ip_address: normalizeIpForPersistence(args.ipAddress ?? ctx?.clientIp),
        user_agent: normalizeUserAgentForPersistence(
          args.userAgent ?? ctx?.userAgent,
        ),
      },
    });
  }

  private sellerAuditLogWhere(
    args: SellerAuditLogScope,
  ): Prisma.AuditLogWhereInput {
    return {
      OR: [
        { actor_account_id: args.sellerAccountId },
        { store_id: args.storeId },
      ],
      // 관리자 조작(REVIEW·ACCOUNT 등)이 매장 ID를 달고 기록돼도 판매자 화면 enum 밖이라 제외한다
      target_type: {
        in: args.targetType
          ? [args.targetType]
          : [...SELLER_AUDIT_TARGET_TYPES],
      },
    };
  }

  async countAuditLogsBySeller(scope: SellerAuditLogScope): Promise<number> {
    return this.prisma.auditLog.count({
      where: this.sellerAuditLogWhere(scope),
    });
  }

  async listAuditLogsBySeller(
    args: SellerAuditLogScope & { limit: number; cursor?: bigint },
  ): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.sellerAuditLogWhere(args),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }
}

/**
 * trust proxy 환경에서 req.ip는 프록시가 넘긴 값이라 malformed·overlong 값이 그대로 오면 ip_address VarChar(64)
 * 초과로 insert가 실패할 수 있다. 유효한 IPv4/IPv6가 아니면 null로 떨어뜨린다.
 */
function normalizeIpForPersistence(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return isIP(value) !== 0 ? value : null;
}

function normalizeUserAgentForPersistence(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return value.slice(0, MAX_USER_AGENT_LENGTH);
}
