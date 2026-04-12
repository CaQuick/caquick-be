import { Injectable } from '@nestjs/common';
import {
  AuditActionType,
  AuditTargetType,
  NotificationEvent,
  NotificationType,
  OrderStatus,
} from '@prisma/client';

import { PrismaService } from '@/prisma';

export interface OngoingOrderRow {
  id: bigint;
  order_number: string;
  status: OrderStatus;
  created_at: Date;
  pickup_at: Date;
  total_price: number;
  items: {
    product_name_snapshot: string;
    product: {
      images: { image_url: string }[];
    };
  }[];
}

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOngoingOrdersByAccount(args: {
    accountId: bigint;
    since: Date;
    limit: number;
  }): Promise<OngoingOrderRow[]> {
    return this.prisma.order.findMany({
      where: {
        account_id: args.accountId,
        status: {
          in: [OrderStatus.SUBMITTED, OrderStatus.CONFIRMED, OrderStatus.MADE],
        },
        created_at: { gte: args.since },
      },
      orderBy: { created_at: 'desc' },
      take: args.limit,
      include: {
        items: {
          where: { deleted_at: null },
          orderBy: { id: 'asc' },
          take: 1,
          include: {
            product: {
              select: {
                images: {
                  where: { deleted_at: null },
                  orderBy: { sort_order: 'asc' },
                  take: 1,
                  select: { image_url: true },
                },
              },
            },
          },
        },
      },
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
