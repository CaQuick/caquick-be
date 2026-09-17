import type {
  AuditActionType,
  AuditLog,
  AuditTargetType,
  Prisma,
} from '@/generated/prisma/client';

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');

export interface IAuditLogRepository {
  /**
   * tx를 넘기면 같은 트랜잭션에 기록돼 본 조작과 함께 커밋/롤백된다 —
   * 조작은 커밋됐는데 감사 기록만 빠지는 상태를 막는다.
   */
  createAuditLog(
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
  ): Promise<AuditLog>;
}
