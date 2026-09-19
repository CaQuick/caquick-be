import type {
  AuditActionType,
  AuditLog,
  AuditTargetType,
  Prisma,
} from '@/generated/prisma/client';

/** 관리자 전역 조회 필터. */
export interface AuditLogFilter {
  actorAccountId?: bigint;
  storeId?: bigint;
  targetType?: AuditTargetType;
  targetId?: bigint;
  action?: AuditActionType;
  fromCreatedAt?: Date;
  toCreatedAt?: Date;
}

/** 판매자 화면 조회 범위: 본인이 행위자이거나 본인 매장이 대상인 기록. */
export interface SellerAuditLogScope {
  sellerAccountId: bigint;
  storeId: bigint;
  targetType?: AuditTargetType;
}

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');

export interface IAuditLogRepository {
  /**
   * 감사 기록의 유일한 쓰기 경로. tx가 **필수**라 본 조작과 항상 같은 트랜잭션에 남는다 —
   * 조작은 커밋됐는데 기록만 빠지는 상태를 타입 수준에서 막는다(P1-12).
   * ip/ua는 넘기지 않으면 요청 컨텍스트(ALS)에서 보강한다.
   */
  recordAudit(
    tx: Prisma.TransactionClient,
    entry: {
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
  ): Promise<AuditLog>;

  /** 판매자 화면용 목록·건수. 페이지 판정은 limit+1 조회로 호출자가 한다. */
  countAuditLogsBySeller(scope: SellerAuditLogScope): Promise<number>;
  listAuditLogsBySeller(
    args: SellerAuditLogScope & { limit: number; cursor?: bigint },
  ): Promise<AuditLog[]>;

  /** 관리자 전역 목록·건수. 행위자 종류는 호출자가 identity에서 붙인다(AuditLog에 계정 FK가 없다). */
  countAuditLogs(filter: AuditLogFilter): Promise<number>;
  listAuditLogs(
    args: AuditLogFilter & { limit: number; cursor?: bigint },
  ): Promise<AuditLog[]>;
}

/** recordAudit 항목 — 도메인 repository가 tx 안에서 기록할 내용을 받을 때 쓴다. */
export type AuditEntry = Parameters<IAuditLogRepository['recordAudit']>[1];
