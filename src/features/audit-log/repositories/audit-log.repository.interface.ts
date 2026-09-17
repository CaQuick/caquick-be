import type {
  AuditActionType,
  AuditLog,
  AuditTargetType,
  Prisma,
} from '@/generated/prisma/client';

/**
 * AuditLog Repository 토큰 (Nest DI 주입용).
 */
export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');

/**
 * AuditLog Repository 인터페이스.
 *
 * 모든 도메인(auth/seller/...)의 감사 로그 작성 진입점.
 * 단일 책임: AuditLog 테이블 write.
 */
export interface IAuditLogRepository {
  /**
   * 감사 로그를 생성한다.
   *
   * @param args 감사 로그 작성 정보
   * @param tx 진행 중인 트랜잭션. 넘기면 같은 트랜잭션에 기록돼 본 조작과 함께 커밋/롤백된다 —
   *   조작은 커밋됐는데 감사 기록만 빠지는 상태를 막는다.
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
