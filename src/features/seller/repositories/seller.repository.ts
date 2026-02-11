import { Injectable } from '@nestjs/common';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  BannerLinkType,
  BannerPlacement,
  Prisma,
  type PrismaClient,
} from '@prisma/client';

import { PrismaService } from '../../../prisma';

@Injectable()
export class SellerRepository {
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

  async upsertStoreSpecialClosure(args: {
    storeId: bigint;
    closureId?: bigint;
    closureDate: Date;
    reason: string | null;
  }) {
    if (args.closureId) {
      return this.prisma.storeSpecialClosure.update({
        where: { id: args.closureId },
        data: {
          closure_date: args.closureDate,
          reason: args.reason,
        },
      });
    }

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

  async upsertStoreDailyCapacity(args: {
    storeId: bigint;
    capacityId?: bigint;
    capacityDate: Date;
    capacity: number;
  }) {
    if (args.capacityId) {
      return this.prisma.storeDailyCapacity.update({
        where: { id: args.capacityId },
        data: {
          capacity_date: args.capacityDate,
          capacity: args.capacity,
        },
      });
    }

    return this.prisma.storeDailyCapacity.upsert({
      where: {
        store_id_capacity_date: {
          store_id: args.storeId,
          capacity_date: args.capacityDate,
        },
      },
      create: {
        store_id: args.storeId,
        capacity_date: args.capacityDate,
        capacity: args.capacity,
      },
      update: {
        capacity: args.capacity,
      },
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

  async softDeleteStoreDailyCapacity(id: bigint): Promise<void> {
    await this.prisma.storeDailyCapacity.update({
      where: { id },
      data: { deleted_at: new Date() },
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
        store_id: args.storeId,
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...(args.fromDate || args.toDate
          ? {
              capacity_date: {
                ...(args.fromDate ? { gte: args.fromDate } : {}),
                ...(args.toDate ? { lte: args.toDate } : {}),
              },
            }
          : {}),
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

  async listBannersByStore(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
  }) {
    return this.prisma.banner.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        OR: [
          {
            link_store_id: args.storeId,
          },
          {
            link_product: {
              store_id: args.storeId,
            },
          },
        ],
      },
      orderBy: [{ id: 'desc' }],
      take: args.limit + 1,
    });
  }

  async findBannerByIdForStore(args: { bannerId: bigint; storeId: bigint }) {
    return this.prisma.banner.findFirst({
      where: {
        id: args.bannerId,
        OR: [
          {
            link_store_id: args.storeId,
          },
          {
            link_product: {
              store_id: args.storeId,
            },
          },
        ],
      },
    });
  }

  async createBanner(args: {
    placement: BannerPlacement;
    title: string | null;
    imageUrl: string;
    linkType: BannerLinkType;
    linkUrl: string | null;
    linkProductId: bigint | null;
    linkStoreId: bigint | null;
    linkCategoryId: bigint | null;
    startsAt: Date | null;
    endsAt: Date | null;
    sortOrder: number;
    isActive: boolean;
  }) {
    return this.prisma.banner.create({
      data: {
        placement: args.placement,
        title: args.title,
        image_url: args.imageUrl,
        link_type: args.linkType,
        link_url: args.linkUrl,
        link_product_id: args.linkProductId,
        link_store_id: args.linkStoreId,
        link_category_id: args.linkCategoryId,
        starts_at: args.startsAt,
        ends_at: args.endsAt,
        sort_order: args.sortOrder,
        is_active: args.isActive,
      },
    });
  }

  async updateBanner(args: {
    bannerId: bigint;
    data: Prisma.BannerUpdateInput;
  }) {
    return this.prisma.banner.update({
      where: { id: args.bannerId },
      data: args.data,
    });
  }

  async softDeleteBanner(bannerId: bigint): Promise<void> {
    await this.prisma.banner.update({
      where: { id: bannerId },
      data: {
        deleted_at: new Date(),
      },
    });
  }

  async findProductOwnership(args: { productId: bigint; storeId: bigint }) {
    return this.prisma.product.findFirst({
      where: {
        id: args.productId,
        store_id: args.storeId,
      },
      select: {
        id: true,
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
        OR: [
          { actor_account_id: args.sellerAccountId },
          { store_id: args.storeId },
        ],
        ...(args.targetType ? { target_type: args.targetType } : {}),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async createAuditLog(args: {
    actorAccountId: bigint;
    storeId?: bigint;
    targetType: AuditTargetType;
    targetId: bigint;
    action: AuditActionType;
    beforeJson?: Prisma.InputJsonValue | null;
    afterJson?: Prisma.InputJsonValue | null;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        actor_account_id: args.actorAccountId,
        store_id: args.storeId,
        target_type: args.targetType,
        target_id: args.targetId,
        action: args.action,
        before_json:
          args.beforeJson === null ? Prisma.JsonNull : args.beforeJson,
        after_json: args.afterJson === null ? Prisma.JsonNull : args.afterJson,
        ip_address: args.ipAddress,
        user_agent: args.userAgent,
      },
    });
  }
}

export function normalizeCursorInput(input?: {
  limit?: number | null;
  cursor?: bigint | null;
}): { limit: number; cursor?: bigint } {
  const safeLimit = Math.min(Math.max(input?.limit ?? 20, 1), 100);
  const cursor = input?.cursor ?? undefined;
  return {
    limit: safeLimit,
    ...(cursor ? { cursor } : {}),
  };
}

export function nextCursorOf<T extends { id: bigint }>(
  rows: T[],
  limit: number,
): {
  items: T[];
  nextCursor: string | null;
} {
  if (rows.length <= limit) {
    return {
      items: rows,
      nextCursor: null,
    };
  }

  const sliced = rows.slice(0, limit);
  return {
    items: sliced,
    nextCursor: sliced[sliced.length - 1]?.id.toString() ?? null,
  };
}

export function isSellerAccount(accountType: AccountType): boolean {
  return accountType === AccountType.SELLER;
}

export type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
