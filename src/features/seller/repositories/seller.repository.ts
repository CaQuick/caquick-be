import { Injectable } from '@nestjs/common';
import {
  AccountType,
  AuditActionType,
  AuditTargetType,
  BannerLinkType,
  BannerPlacement,
  ConversationBodyFormat,
  ConversationSenderType,
  NotificationEvent,
  NotificationType,
  OrderStatus,
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

  async listProductsByStore(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
    isActive?: boolean;
    categoryId?: bigint;
    search?: string;
  }) {
    return this.prisma.product.findMany({
      where: {
        store_id: args.storeId,
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...(args.isActive !== undefined ? { is_active: args.isActive } : {}),
        ...(args.categoryId
          ? {
              product_categories: {
                some: {
                  category_id: args.categoryId,
                },
              },
            }
          : {}),
        ...(args.search
          ? {
              OR: [
                { name: { contains: args.search } },
                {
                  product_tags: {
                    some: {
                      tag: {
                        name: { contains: args.search },
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        images: { orderBy: { sort_order: 'asc' } },
        product_categories: {
          include: {
            category: true,
          },
        },
        product_tags: {
          include: {
            tag: true,
          },
        },
        option_groups: {
          orderBy: { sort_order: 'asc' },
          include: {
            option_items: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
        custom_template: {
          include: {
            text_tokens: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async findProductById(args: { productId: bigint; storeId: bigint }) {
    return this.prisma.product.findFirst({
      where: {
        id: args.productId,
        store_id: args.storeId,
        is_active: true,
      },
      include: {
        images: { orderBy: { sort_order: 'asc' } },
        product_categories: {
          include: {
            category: true,
          },
        },
        product_tags: {
          include: {
            tag: true,
          },
        },
        option_groups: {
          orderBy: { sort_order: 'asc' },
          include: {
            option_items: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
        custom_template: {
          include: {
            text_tokens: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
      },
    });
  }

  async findProductByIdIncludingInactive(args: {
    productId: bigint;
    storeId: bigint;
  }) {
    return this.prisma.product.findFirst({
      where: {
        id: args.productId,
        store_id: args.storeId,
      },
      include: {
        images: { orderBy: { sort_order: 'asc' } },
        product_categories: {
          include: {
            category: true,
          },
        },
        product_tags: {
          include: {
            tag: true,
          },
        },
        option_groups: {
          orderBy: { sort_order: 'asc' },
          include: {
            option_items: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
        custom_template: {
          include: {
            text_tokens: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
      },
    });
  }

  async createProduct(args: {
    storeId: bigint;
    data: Omit<Prisma.ProductUncheckedCreateInput, 'store_id'>;
  }) {
    return this.prisma.product.create({
      data: {
        store_id: args.storeId,
        ...args.data,
      },
    });
  }

  async updateProduct(args: {
    productId: bigint;
    data: Prisma.ProductUpdateInput;
  }) {
    return this.prisma.product.update({
      where: { id: args.productId },
      data: args.data,
    });
  }

  async softDeleteProduct(productId: bigint): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        deleted_at: new Date(),
        is_active: false,
      },
    });
  }

  async countProductImages(productId: bigint): Promise<number> {
    return this.prisma.productImage.count({
      where: { product_id: productId },
    });
  }

  async addProductImage(args: {
    productId: bigint;
    imageUrl: string;
    sortOrder: number;
  }) {
    return this.prisma.productImage.create({
      data: {
        product_id: args.productId,
        image_url: args.imageUrl,
        sort_order: args.sortOrder,
      },
    });
  }

  async findProductImageById(imageId: bigint) {
    return this.prisma.productImage.findFirst({
      where: { id: imageId },
      include: {
        product: {
          select: {
            id: true,
            store_id: true,
          },
        },
      },
    });
  }

  async listProductImages(productId: bigint) {
    return this.prisma.productImage.findMany({
      where: {
        product_id: productId,
      },
      orderBy: { sort_order: 'asc' },
    });
  }

  async softDeleteProductImage(imageId: bigint): Promise<void> {
    await this.prisma.productImage.update({
      where: { id: imageId },
      data: { deleted_at: new Date() },
    });
  }

  async reorderProductImages(args: { productId: bigint; imageIds: bigint[] }) {
    return this.prisma.$transaction(async (tx) => {
      await Promise.all(
        args.imageIds.map((id, index) =>
          tx.productImage.update({
            where: { id },
            data: { sort_order: index },
          }),
        ),
      );

      return tx.productImage.findMany({
        where: {
          product_id: args.productId,
        },
        orderBy: { sort_order: 'asc' },
      });
    });
  }

  async findCategoryIds(ids: bigint[]) {
    return this.prisma.category.findMany({
      where: {
        id: { in: ids },
      },
      select: { id: true },
    });
  }

  async findTagIds(ids: bigint[]) {
    return this.prisma.tag.findMany({
      where: {
        id: { in: ids },
      },
      select: { id: true },
    });
  }

  async replaceProductCategories(args: {
    productId: bigint;
    categoryIds: bigint[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productCategory.deleteMany({
        where: {
          product_id: args.productId,
        },
      });

      if (args.categoryIds.length > 0) {
        await tx.productCategory.createMany({
          data: args.categoryIds.map((categoryId) => ({
            product_id: args.productId,
            category_id: categoryId,
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  async replaceProductTags(args: {
    productId: bigint;
    tagIds: bigint[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productTag.deleteMany({
        where: {
          product_id: args.productId,
        },
      });

      if (args.tagIds.length > 0) {
        await tx.productTag.createMany({
          data: args.tagIds.map((tagId) => ({
            product_id: args.productId,
            tag_id: tagId,
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  async createOptionGroup(args: {
    productId: bigint;
    data: Omit<Prisma.ProductOptionGroupUncheckedCreateInput, 'product_id'>;
  }) {
    return this.prisma.productOptionGroup.create({
      data: {
        product_id: args.productId,
        ...args.data,
      },
      include: {
        option_items: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async findOptionGroupById(id: bigint) {
    return this.prisma.productOptionGroup.findFirst({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            store_id: true,
          },
        },
        option_items: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async updateOptionGroup(args: {
    optionGroupId: bigint;
    data: Prisma.ProductOptionGroupUpdateInput;
  }) {
    return this.prisma.productOptionGroup.update({
      where: { id: args.optionGroupId },
      data: args.data,
      include: {
        option_items: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async softDeleteOptionGroup(optionGroupId: bigint): Promise<void> {
    await this.prisma.productOptionGroup.update({
      where: { id: optionGroupId },
      data: {
        deleted_at: new Date(),
        is_active: false,
      },
    });
  }

  async listOptionGroupsByProduct(productId: bigint) {
    return this.prisma.productOptionGroup.findMany({
      where: { product_id: productId },
      orderBy: { sort_order: 'asc' },
      include: {
        option_items: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async reorderOptionGroups(args: {
    productId: bigint;
    optionGroupIds: bigint[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      await Promise.all(
        args.optionGroupIds.map((id, index) =>
          tx.productOptionGroup.update({
            where: { id },
            data: { sort_order: index },
          }),
        ),
      );

      return tx.productOptionGroup.findMany({
        where: { product_id: args.productId },
        orderBy: { sort_order: 'asc' },
        include: {
          option_items: {
            orderBy: { sort_order: 'asc' },
          },
        },
      });
    });
  }

  async createOptionItem(args: {
    optionGroupId: bigint;
    data: Omit<Prisma.ProductOptionItemUncheckedCreateInput, 'option_group_id'>;
  }) {
    return this.prisma.productOptionItem.create({
      data: {
        option_group_id: args.optionGroupId,
        ...args.data,
      },
    });
  }

  async findOptionItemById(id: bigint) {
    return this.prisma.productOptionItem.findFirst({
      where: { id },
      include: {
        option_group: {
          include: {
            product: {
              select: {
                id: true,
                store_id: true,
              },
            },
          },
        },
      },
    });
  }

  async updateOptionItem(args: {
    optionItemId: bigint;
    data: Prisma.ProductOptionItemUpdateInput;
  }) {
    return this.prisma.productOptionItem.update({
      where: { id: args.optionItemId },
      data: args.data,
    });
  }

  async softDeleteOptionItem(optionItemId: bigint): Promise<void> {
    await this.prisma.productOptionItem.update({
      where: { id: optionItemId },
      data: {
        deleted_at: new Date(),
        is_active: false,
      },
    });
  }

  async listOptionItemsByGroup(optionGroupId: bigint) {
    return this.prisma.productOptionItem.findMany({
      where: { option_group_id: optionGroupId },
      orderBy: { sort_order: 'asc' },
    });
  }

  async reorderOptionItems(args: {
    optionGroupId: bigint;
    optionItemIds: bigint[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      await Promise.all(
        args.optionItemIds.map((id, index) =>
          tx.productOptionItem.update({
            where: { id },
            data: { sort_order: index },
          }),
        ),
      );

      return tx.productOptionItem.findMany({
        where: { option_group_id: args.optionGroupId },
        orderBy: { sort_order: 'asc' },
      });
    });
  }

  async upsertProductCustomTemplate(args: {
    productId: bigint;
    baseImageUrl: string;
    isActive: boolean;
  }) {
    return this.prisma.productCustomTemplate.upsert({
      where: {
        product_id: args.productId,
      },
      create: {
        product_id: args.productId,
        base_image_url: args.baseImageUrl,
        is_active: args.isActive,
      },
      update: {
        base_image_url: args.baseImageUrl,
        is_active: args.isActive,
      },
      include: {
        text_tokens: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async findCustomTemplateById(id: bigint) {
    return this.prisma.productCustomTemplate.findFirst({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            store_id: true,
          },
        },
        text_tokens: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async setCustomTemplateActive(templateId: bigint, isActive: boolean) {
    return this.prisma.productCustomTemplate.update({
      where: { id: templateId },
      data: {
        is_active: isActive,
      },
      include: {
        text_tokens: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async upsertCustomTextToken(args: {
    tokenId?: bigint;
    templateId: bigint;
    tokenKey: string;
    defaultText: string;
    maxLength: number;
    sortOrder: number;
    isRequired: boolean;
    posX: number | null;
    posY: number | null;
    width: number | null;
    height: number | null;
  }) {
    if (args.tokenId) {
      return this.prisma.productCustomTextToken.update({
        where: { id: args.tokenId },
        data: {
          token_key: args.tokenKey,
          default_text: args.defaultText,
          max_length: args.maxLength,
          sort_order: args.sortOrder,
          is_required: args.isRequired,
          pos_x: args.posX,
          pos_y: args.posY,
          width: args.width,
          height: args.height,
        },
      });
    }

    return this.prisma.productCustomTextToken.create({
      data: {
        template_id: args.templateId,
        token_key: args.tokenKey,
        default_text: args.defaultText,
        max_length: args.maxLength,
        sort_order: args.sortOrder,
        is_required: args.isRequired,
        pos_x: args.posX,
        pos_y: args.posY,
        width: args.width,
        height: args.height,
      },
    });
  }

  async findCustomTextTokenById(id: bigint) {
    return this.prisma.productCustomTextToken.findFirst({
      where: { id },
      include: {
        template: {
          include: {
            product: {
              select: {
                id: true,
                store_id: true,
              },
            },
          },
        },
      },
    });
  }

  async softDeleteCustomTextToken(id: bigint): Promise<void> {
    await this.prisma.productCustomTextToken.update({
      where: { id },
      data: {
        deleted_at: new Date(),
      },
    });
  }

  async listCustomTextTokens(templateId: bigint) {
    return this.prisma.productCustomTextToken.findMany({
      where: {
        template_id: templateId,
      },
      orderBy: { sort_order: 'asc' },
    });
  }

  async reorderCustomTextTokens(args: {
    templateId: bigint;
    tokenIds: bigint[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      await Promise.all(
        args.tokenIds.map((id, index) =>
          tx.productCustomTextToken.update({
            where: { id },
            data: { sort_order: index },
          }),
        ),
      );

      return tx.productCustomTextToken.findMany({
        where: {
          template_id: args.templateId,
        },
        orderBy: { sort_order: 'asc' },
      });
    });
  }

  async listOrdersByStore(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
    status?: OrderStatus;
    fromCreatedAt?: Date;
    toCreatedAt?: Date;
    fromPickupAt?: Date;
    toPickupAt?: Date;
    search?: string;
  }) {
    return this.prisma.order.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.fromCreatedAt || args.toCreatedAt
          ? {
              created_at: {
                ...(args.fromCreatedAt ? { gte: args.fromCreatedAt } : {}),
                ...(args.toCreatedAt ? { lte: args.toCreatedAt } : {}),
              },
            }
          : {}),
        ...(args.fromPickupAt || args.toPickupAt
          ? {
              pickup_at: {
                ...(args.fromPickupAt ? { gte: args.fromPickupAt } : {}),
                ...(args.toPickupAt ? { lte: args.toPickupAt } : {}),
              },
            }
          : {}),
        ...(args.search
          ? {
              OR: [
                { order_number: { contains: args.search } },
                { buyer_name: { contains: args.search } },
                { buyer_phone: { contains: args.search } },
              ],
            }
          : {}),
        items: {
          some: {
            store_id: args.storeId,
          },
        },
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async findOrderDetailByStore(args: { orderId: bigint; storeId: bigint }) {
    return this.prisma.order.findFirst({
      where: {
        id: args.orderId,
        items: {
          some: {
            store_id: args.storeId,
          },
        },
      },
      include: {
        status_histories: {
          orderBy: {
            changed_at: 'desc',
          },
        },
        items: {
          where: {
            store_id: args.storeId,
          },
          include: {
            option_items: true,
            custom_texts: {
              orderBy: { sort_order: 'asc' },
            },
            free_edits: {
              orderBy: { sort_order: 'asc' },
              include: {
                attachments: {
                  orderBy: { sort_order: 'asc' },
                },
              },
            },
          },
        },
      },
    });
  }

  async updateOrderStatusBySeller(args: {
    orderId: bigint;
    storeId: bigint;
    actorAccountId: bigint;
    toStatus: OrderStatus;
    note: string | null;
    now: Date;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: {
          id: args.orderId,
          items: {
            some: {
              store_id: args.storeId,
            },
          },
        },
      });

      if (!order) {
        return null;
      }

      const fromStatus = order.status;

      const updatedOrder = await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          status: args.toStatus,
          ...(args.toStatus === OrderStatus.CONFIRMED
            ? { confirmed_at: args.now }
            : {}),
          ...(args.toStatus === OrderStatus.MADE ? { made_at: args.now } : {}),
          ...(args.toStatus === OrderStatus.PICKED_UP
            ? { picked_up_at: args.now }
            : {}),
          ...(args.toStatus === OrderStatus.CANCELED
            ? { canceled_at: args.now }
            : {}),
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          order_id: order.id,
          from_status: fromStatus,
          to_status: args.toStatus,
          changed_at: args.now,
          note: args.note,
        },
      });

      const notificationEvent = this.orderStatusToNotificationEvent(
        args.toStatus,
      );
      if (notificationEvent) {
        await tx.notification.create({
          data: {
            account_id: order.account_id,
            type: NotificationType.ORDER_STATUS,
            title: this.notificationTitleByOrderStatus(args.toStatus),
            body: this.notificationBodyByOrderStatus(
              updatedOrder.order_number,
              args.toStatus,
            ),
            event: notificationEvent,
            order_id: order.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actor_account_id: args.actorAccountId,
          store_id: args.storeId,
          target_type: AuditTargetType.ORDER,
          target_id: order.id,
          action: AuditActionType.STATUS_CHANGE,
          before_json: {
            status: fromStatus,
          },
          after_json: {
            status: args.toStatus,
            note: args.note,
          },
          ip_address: args.ipAddress ?? null,
          user_agent: args.userAgent ?? null,
        },
      });

      return updatedOrder;
    });
  }

  async listConversationsByStore(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
  }) {
    return this.prisma.storeConversation.findMany({
      where: {
        store_id: args.storeId,
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
      },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      take: args.limit + 1,
    });
  }

  async findConversationByIdAndStore(args: {
    conversationId: bigint;
    storeId: bigint;
  }) {
    return this.prisma.storeConversation.findFirst({
      where: {
        id: args.conversationId,
        store_id: args.storeId,
      },
    });
  }

  async listConversationMessages(args: {
    conversationId: bigint;
    limit: number;
    cursor?: bigint;
  }) {
    return this.prisma.storeConversationMessage.findMany({
      where: {
        conversation_id: args.conversationId,
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async createSellerConversationMessage(args: {
    conversationId: bigint;
    sellerAccountId: bigint;
    bodyFormat: ConversationBodyFormat;
    bodyText: string | null;
    bodyHtml: string | null;
    now: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.storeConversationMessage.create({
        data: {
          conversation_id: args.conversationId,
          sender_type: ConversationSenderType.STORE,
          sender_account_id: args.sellerAccountId,
          body_format: args.bodyFormat,
          body_text: args.bodyText,
          body_html: args.bodyHtml,
          created_at: args.now,
        },
      });

      await tx.storeConversation.update({
        where: { id: args.conversationId },
        data: {
          last_message_at: args.now,
          updated_at: args.now,
        },
      });

      return message;
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

  private orderStatusToNotificationEvent(
    status: OrderStatus,
  ): NotificationEvent | null {
    if (status === OrderStatus.CONFIRMED)
      return NotificationEvent.ORDER_CONFIRMED;
    if (status === OrderStatus.MADE) return NotificationEvent.ORDER_MADE;
    if (status === OrderStatus.PICKED_UP)
      return NotificationEvent.ORDER_PICKED_UP;
    return null;
  }

  private notificationTitleByOrderStatus(status: OrderStatus): string {
    if (status === OrderStatus.CONFIRMED) return '주문이 확정되었습니다';
    if (status === OrderStatus.MADE) return '주문이 제작 완료되었습니다';
    if (status === OrderStatus.PICKED_UP) return '주문이 픽업 처리되었습니다';
    if (status === OrderStatus.CANCELED) return '주문이 취소되었습니다';
    return '주문 상태가 변경되었습니다';
  }

  private notificationBodyByOrderStatus(
    orderNumber: string,
    status: OrderStatus,
  ): string {
    if (status === OrderStatus.CONFIRMED) {
      return `${orderNumber} 주문이 확정되었습니다.`;
    }
    if (status === OrderStatus.MADE) {
      return `${orderNumber} 주문의 상품 제작이 완료되었습니다.`;
    }
    if (status === OrderStatus.PICKED_UP) {
      return `${orderNumber} 주문이 픽업 완료 처리되었습니다.`;
    }
    if (status === OrderStatus.CANCELED) {
      return `${orderNumber} 주문이 취소되었습니다.`;
    }
    return `${orderNumber} 주문 상태가 변경되었습니다.`;
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
