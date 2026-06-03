import { isIP } from 'node:net';

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

/** `audit_log.user_agent` 컬럼 길이(VarChar(512)) 상한. */
const MAX_USER_AGENT_LENGTH = 512;

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
        ip_address: normalizeIpForPersistence(args.ipAddress ?? ctx?.clientIp),
        user_agent: normalizeUserAgentForPersistence(
          args.userAgent ?? ctx?.userAgent,
        ),
      },
    });
  }
}

/**
 * 감사 로그 컬럼(`ip_address` VarChar(64))에 저장 가능한 IP 로 정규화한다.
 *
 * trust proxy 환경에서 `req.ip` 는 프록시가 넘긴 값을 반영하므로, malformed·overlong
 * 값이 그대로 들어오면 컬럼 길이 초과로 insert 가 실패할 수 있다. 유효한 IPv4/IPv6 가
 * 아니면 null 로 떨어뜨려, 감사 로그에 쓰레기 IP 가 쌓이거나 mutation 이 깨지는 것을 막는다.
 */
function normalizeIpForPersistence(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return isIP(value) !== 0 ? value : null;
}

/**
 * 감사 로그 컬럼(`user_agent` VarChar(512))에 저장 가능한 UA 로 정규화한다.
 * 컬럼 길이 초과 방지를 위해 512 자로 자른다.
 */
function normalizeUserAgentForPersistence(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return value.slice(0, MAX_USER_AGENT_LENGTH);
}
