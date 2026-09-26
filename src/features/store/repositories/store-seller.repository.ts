import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditEntry,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  AccountType,
  Prisma,
  type Store,
  type StoreBusinessHour,
  type StoreFaqTopic,
  type StoreSpecialClosure,
} from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/** 판매자 관점의 매장 조작(내 매장·영업시간·휴무·일별 수량·FAQ)과 판매자 컨텍스트 조회. */
@Injectable()
export class StoreSellerRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /**
   * 도메인 write와 감사 기록을 한 트랜잭션으로 묶는다 — 조작만 커밋되고 기록이 빠지는 상태를 막는다.
   * 판매자 매장 조작이 모두 이 헬퍼를 거친다.
   */
  private async writeWithAudit<T>(
    write: (tx: Prisma.TransactionClient) => Promise<T>,
    audit: (result: T) => AuditEntry,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const result = await write(tx);
      await this.auditLogs.recordAudit(tx, audit(result));
      return result;
    });
  }

  async findSellerAccountContext(accountId: bigint) {
    return this.prisma.account.findFirst({
      where: { id: accountId },
      select: {
        id: true,
        account_type: true,
        status: true,
        store: {
          select: {
            id: true,
          },
        },
      },
    });
  }

  async findStoreBySellerAccountId(accountId: bigint) {
    return this.prisma.store.findFirst({
      where: { seller_account_id: accountId },
    });
  }

  async updateStore(
    args: { storeId: bigint; data: Prisma.StoreUpdateInput },
    audit: (row: Store) => AuditEntry,
  ) {
    return this.writeWithAudit(
      (tx) =>
        tx.store.update({
          where: { id: args.storeId },
          data: args.data,
        }),
      audit,
    );
  }

  async listStoreBusinessHours(storeId: bigint) {
    return this.prisma.storeBusinessHour.findMany({
      where: { store_id: storeId },
      orderBy: { day_of_week: 'asc' },
    });
  }

  async upsertStoreBusinessHour(
    args: {
      storeId: bigint;
      dayOfWeek: number;
      isClosed: boolean;
      openTime: Date | null;
      closeTime: Date | null;
    },
    audit: (row: StoreBusinessHour) => AuditEntry,
  ) {
    return this.writeWithAudit(
      (tx) =>
        tx.storeBusinessHour.upsert({
          where: {
            store_id_day_of_week: {
              store_id: args.storeId,
              day_of_week: args.dayOfWeek,
            },
          },
          create: {
            store_id: args.storeId,
            day_of_week: args.dayOfWeek,
            is_closed: args.isClosed,
            open_time: args.openTime,
            close_time: args.closeTime,
          },
          update: {
            is_closed: args.isClosed,
            open_time: args.openTime,
            close_time: args.closeTime,
          },
        }),
      audit,
    );
  }

  async updateStoreSpecialClosure(
    closureId: bigint,
    data: { closureDate: Date; reason: string | null },
    audit: (row: StoreSpecialClosure) => AuditEntry,
  ) {
    return this.writeWithAudit(
      (tx) =>
        tx.storeSpecialClosure.update({
          where: { id: closureId },
          data: {
            closure_date: data.closureDate,
            reason: data.reason,
          },
        }),
      audit,
    );
  }

  async createStoreSpecialClosure(
    args: {
      storeId: bigint;
      closureDate: Date;
      reason: string | null;
    },
    audit: (row: StoreSpecialClosure) => AuditEntry,
  ) {
    return this.writeWithAudit(
      (tx) =>
        tx.storeSpecialClosure.upsert({
          where: {
            store_id_closure_date: {
              store_id: args.storeId,
              closure_date: args.closureDate,
            },
          },
          create: {
            store_id: args.storeId,
            closure_date: args.closureDate,
            reason: args.reason,
          },
          update: {
            deleted_at: null,
            reason: args.reason,
          },
        }),
      audit,
    );
  }

  async findStoreSpecialClosureById(closureId: bigint, storeId: bigint) {
    return this.prisma.storeSpecialClosure.findFirst({
      where: {
        id: closureId,
        store_id: storeId,
      },
    });
  }

  async softDeleteStoreSpecialClosure(
    closureId: bigint,
    audit: (row: { id: bigint }) => AuditEntry,
  ): Promise<void> {
    await this.writeWithAudit(
      (tx) =>
        tx.storeSpecialClosure.update({
          where: { id: closureId },
          data: { deleted_at: new Date() },
        }),
      audit,
    );
  }

  async listStoreSpecialClosures(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
  }) {
    return this.prisma.storeSpecialClosure.findMany({
      where: {
        store_id: args.storeId,
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countStoreSpecialClosures(storeId: bigint): Promise<number> {
    return this.prisma.storeSpecialClosure.count({
      where: { store_id: storeId },
    });
  }

  async findStoreDailyCapacityById(id: bigint, storeId: bigint) {
    return this.prisma.storeDailyCapacity.findFirst({
      where: {
        id,
        store_id: storeId,
      },
    });
  }

  /** 목록과 카운트가 공유한다. */
  private dailyCapacityScopeWhere(args: {
    storeId: bigint;
    fromDate?: Date;
    toDate?: Date;
  }): Prisma.StoreDailyCapacityWhereInput {
    return {
      store_id: args.storeId,
      ...(args.fromDate || args.toDate
        ? {
            capacity_date: {
              ...(args.fromDate ? { gte: args.fromDate } : {}),
              ...(args.toDate ? { lte: args.toDate } : {}),
            },
          }
        : {}),
    };
  }

  async countStoreDailyCapacities(args: {
    storeId: bigint;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<number> {
    return this.prisma.storeDailyCapacity.count({
      where: this.dailyCapacityScopeWhere(args),
    });
  }

  async listStoreDailyCapacities(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
    fromDate?: Date;
    toDate?: Date;
  }) {
    return this.prisma.storeDailyCapacity.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.dailyCapacityScopeWhere(args),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async listFaqTopics(storeId: bigint) {
    return this.prisma.storeFaqTopic.findMany({
      where: {
        store_id: storeId,
      },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });
  }

  async createFaqTopic(
    args: {
      storeId: bigint;
      title: string;
      answerHtml: string;
      sortOrder: number;
      isActive: boolean;
    },
    audit: (row: StoreFaqTopic) => AuditEntry,
  ) {
    return this.writeWithAudit(
      (tx) =>
        tx.storeFaqTopic.create({
          data: {
            store_id: args.storeId,
            title: args.title,
            answer_html: args.answerHtml,
            sort_order: args.sortOrder,
            is_active: args.isActive,
          },
        }),
      audit,
    );
  }

  async findFaqTopicById(args: { topicId: bigint; storeId: bigint }) {
    return this.prisma.storeFaqTopic.findFirst({
      where: {
        id: args.topicId,
        store_id: args.storeId,
      },
    });
  }

  async updateFaqTopic(
    args: {
      topicId: bigint;
      data: Prisma.StoreFaqTopicUpdateInput;
    },
    audit: (row: StoreFaqTopic) => AuditEntry,
  ) {
    return this.writeWithAudit(
      (tx) =>
        tx.storeFaqTopic.update({
          where: { id: args.topicId },
          data: args.data,
        }),
      audit,
    );
  }

  async softDeleteFaqTopic(
    topicId: bigint,
    audit: (row: { id: bigint }) => AuditEntry,
  ): Promise<void> {
    await this.writeWithAudit(
      (tx) =>
        tx.storeFaqTopic.update({
          where: { id: topicId },
          data: {
            deleted_at: new Date(),
          },
        }),
      audit,
    );
  }

  async findStoreOwnership(storeId: bigint) {
    return this.prisma.store.findFirst({
      where: {
        id: storeId,
      },
      select: {
        id: true,
      },
    });
  }

  /** 매장에 연결할 수 있는 지역은 2단계·활성뿐(판매자 계정 생성·관리자 매장 수정 공용). */
  async isRegionSelectable(regionId: bigint): Promise<boolean> {
    return (
      (await this.prisma.region.findFirst({
        where: { id: regionId, level: 2, is_active: true },
        select: { id: true },
      })) !== null
    );
  }
}

export function isSellerAccount(accountType: AccountType): boolean {
  return accountType === AccountType.SELLER;
}
