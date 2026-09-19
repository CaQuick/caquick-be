import type {
  AuditActionType,
  AuditLog,
  AuditTargetType,
  Prisma,
} from '@/generated/prisma/client';

/** 판매자 화면 조회 범위: 본인이 행위자이거나 본인 매장이 대상인 기록. */
export interface SellerAuditLogScope {
  sellerAccountId: bigint;
  storeId: bigint;
  targetType?: AuditTargetType;
}

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

  /** 판매자 화면용 목록·건수. 페이지 판정은 limit+1 조회로 호출자가 한다. */
  countAuditLogsBySeller(scope: SellerAuditLogScope): Promise<number>;
  listAuditLogsBySeller(
    args: SellerAuditLogScope & { limit: number; cursor?: bigint },
  ): Promise<AuditLog[]>;
}

/** createAuditLog 인자 — 도메인 repository가 tx 안에서 기록할 항목을 받을 때 쓴다. */
export type AuditEntry = Parameters<IAuditLogRepository['createAuditLog']>[0];
