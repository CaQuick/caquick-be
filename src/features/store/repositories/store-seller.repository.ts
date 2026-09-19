import { Injectable } from '@nestjs/common';

import { AccountType, Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

/** 판매자 관점의 매장 조작(내 매장·영업시간·휴무·일별 수량·FAQ)과 판매자 컨텍스트 조회. */
@Injectable()
export class StoreSellerRepository {
  constructor(private readonly prisma: PrismaService) {}

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

  async updateStore(args: { storeId: bigint; data: Prisma.StoreUpdateInput }) {
    return this.prisma.store.update({
      where: { id: args.storeId },
      data: args.data,
    });
  }

  async listStoreBusinessHours(storeId: bigint) {
    return this.prisma.storeBusinessHour.findMany({
      where: { store_id: storeId },
      orderBy: { day_of_week: 'asc' },
    });
  }

  async upsertStoreBusinessHour(args: {
    storeId: bigint;
    dayOfWeek: number;
    isClosed: boolean;
    openTime: Date | null;
    closeTime: Date | null;
  }) {
    return this.prisma.storeBusinessHour.upsert({
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
    });
  }

  async updateStoreSpecialClosure(
    closureId: bigint,
    data: { closureDate: Date; reason: string | null },
  ) {
    return this.prisma.storeSpecialClosure.update({
      where: { id: closureId },
      data: {
        closure_date: data.closureDate,
        reason: data.reason,
      },
    });
  }

  async createStoreSpecialClosure(args: {
    storeId: bigint;
    closureDate: Date;
    reason: string | null;
  }) {
    return this.prisma.storeSpecialClosure.upsert({
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
    });
  }

  async findStoreSpecialClosureById(closureId: bigint, storeId: bigint) {
    return this.prisma.storeSpecialClosure.findFirst({
      where: {
        id: closureId,
        store_id: storeId,
      },
    });
  }

  async softDeleteStoreSpecialClosure(closureId: bigint): Promise<void> {
    await this.prisma.storeSpecialClosure.update({
      where: { id: closureId },
      data: { deleted_at: new Date() },
    });
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

  async createFaqTopic(args: {
    storeId: bigint;
    title: string;
    answerHtml: string;
    sortOrder: number;
    isActive: boolean;
  }) {
    return this.prisma.storeFaqTopic.create({
      data: {
        store_id: args.storeId,
        title: args.title,
        answer_html: args.answerHtml,
        sort_order: args.sortOrder,
        is_active: args.isActive,
      },
    });
  }

  async findFaqTopicById(args: { topicId: bigint; storeId: bigint }) {
    return this.prisma.storeFaqTopic.findFirst({
      where: {
        id: args.topicId,
        store_id: args.storeId,
      },
    });
  }

  async updateFaqTopic(args: {
    topicId: bigint;
    data: Prisma.StoreFaqTopicUpdateInput;
  }) {
    return this.prisma.storeFaqTopic.update({
      where: { id: args.topicId },
      data: args.data,
    });
  }

  async softDeleteFaqTopic(topicId: bigint): Promise<void> {
    await this.prisma.storeFaqTopic.update({
      where: { id: topicId },
      data: {
        deleted_at: new Date(),
      },
    });
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
