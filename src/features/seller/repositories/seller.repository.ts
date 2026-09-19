import { Injectable } from '@nestjs/common';

import { SELLER_AUDIT_TARGET_TYPES } from '@/features/seller/constants/seller.constants';
import { AuditTargetType, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/** 판매자 감사 로그 목록(03c에서 audit-log로 이동 예정). */
@Injectable()
export class SellerRepository {
  constructor(private readonly prisma: PrismaService) {}

  private sellerAuditLogWhere(args: {
    sellerAccountId: bigint;
    storeId: bigint;
    targetType?: AuditTargetType;
  }): Prisma.AuditLogWhereInput {
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

  async countAuditLogsBySeller(args: {
    sellerAccountId: bigint;
    storeId: bigint;
    targetType?: AuditTargetType;
  }): Promise<number> {
    return this.prisma.auditLog.count({
      where: this.sellerAuditLogWhere(args),
    });
  }

  async listAuditLogsBySeller(args: {
    sellerAccountId: bigint;
    storeId: bigint;
    limit: number;
    cursor?: bigint;
    targetType?: AuditTargetType;
  }) {
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
