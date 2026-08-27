import { Injectable } from '@nestjs/common';
import {
  AuditActionType,
  AuditTargetType,
  NotificationEvent,
  NotificationType,
  OrderStatus,
  Prisma,
  type AccountType,
} from '@prisma/client';

import { activeWhere, PrismaService } from '@/prisma';

export interface MyOrderRow {
  id: bigint;
  order_number: string;
  status: OrderStatus;
  created_at: Date;
  pickup_at: Date;
  total_price: number;
  items: {
    product_name_snapshot: string;
    store: { store_name: string };
    product: {
      images: { image_url: string }[];
    };
  }[];
  _count: { items: number };
}

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

/**
 * 일일 capacity 원자 검사 조건. 트랜잭션 안에서 capacity 행을 잠그고
 * 점유를 재집계해 검사-삽입 race로 capacity가 초과되는 것을 막는다.
 */
export interface DailyCapacityGuard {
  storeId: bigint;
  /** @db.Date 비교용(해당 KST 달력일의 UTC 자정 표현). */
  dateOnlyUtc: Date;
  /** pickup_at 범위 비교용 KST 자정 경계. */
  dayStartUtc: Date;
  dayEndUtc: Date;
}

/** 주문 생성 입력(스냅샷 값은 서비스가 계산해 전달). */
export interface CreateSubmittedOrderArgs {
  accountId: bigint;
  orderNumber: string;
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  subtotalPrice: number;
  discountPrice: number;
  totalPrice: number;
  submittedAt: Date;
  /** null이면 capacity 원자 검사 생략(호출부가 무제한으로 판단한 경우는 없음 — 항상 전달 권장). */
  capacityGuard: DailyCapacityGuard | null;
  item: {
    storeId: bigint;
    productId: bigint;
    productNameSnapshot: string;
    regularPriceSnapshot: number;
    salePriceSnapshot: number | null;
    quantity: number;
    itemSubtotalPrice: number;
    options: {
      optionGroupId: bigint;
      optionItemId: bigint;
      groupNameSnapshot: string;
      optionTitleSnapshot: string;
      optionPriceDeltaSnapshot: number;
    }[];
  };
}

/** 주문 생성 결과 row(생성 요약 응답용). */
export interface CreatedOrderRow {
  id: bigint;
  order_number: string;
  status: OrderStatus;
  pickup_at: Date;
  total_price: number;
}

/** 리뷰 작성 가능 주문 아이템 row. UserReviewService 매핑 입력. */
export interface ReviewableOrderItemRow {
  id: bigint;
  product_id: bigint;
  product_name_snapshot: string;
  order: { picked_up_at: Date | null } | null;
  product: { images: { image_url: string }[] } | null;
  store: {
    store_name: string;
    address_city: string | null;
    address_neighborhood: string | null;
    region: { name: string } | null;
  } | null;
}

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 구매자 검증·주문자 fallback용 계정+프로필 조회.
   * USER 여부·프로필 활성 판정은 서비스가 한다(requireActiveUser와 동일 의미론).
   */
  async findAccountWithProfileForCheckout(accountId: bigint): Promise<{
    account_type: AccountType;
    user_profile: {
      nickname: string;
      phone_number: string | null;
      deleted_at: Date | null;
    } | null;
  } | null> {
    return this.prisma.account.findFirst({
      where: { id: accountId },
      select: {
        account_type: true,
        user_profile: {
          select: { nickname: true, phone_number: true, deleted_at: true },
        },
      },
    });
  }

  /**
   * SUBMITTED 주문 생성. Order + OrderItem + 옵션 스냅샷 + 상태 히스토리를
   * 트랜잭션으로 원자 생성한다. SUBMITTED는 알림 미발송
   * (알림은 판매자 상태 변경부터 — orderStatusToNotificationEvent 규칙).
   * capacityGuard가 있으면 capacity 행을 FOR UPDATE로 잠근 뒤 점유를
   * 재집계해, 동시 주문이 마지막 잔여를 함께 차지하는 race를 차단한다.
   * capacity 초과면 null을 반환한다(호출부가 도메인 에러로 변환).
   * order_number unique 충돌(P2002)은 호출부가 재시도한다.
   */
  async createSubmittedOrder(
    args: CreateSubmittedOrderArgs,
  ): Promise<CreatedOrderRow | null> {
    return this.prisma.$transaction(async (tx) => {
      if (args.capacityGuard) {
        const exceeded = await this.isCapacityExceededLocked(
          tx,
          args.capacityGuard,
          args.item.quantity,
        );
        if (exceeded) return null;
      }
      return this.insertSubmittedOrder(tx, args);
    });
  }

  /**
   * capacity 행 잠금 후 잔여 재검사. 레코드가 없으면 무제한(검사 통과).
   * FOR UPDATE는 같은 매장·날짜의 동시 주문 생성을 직렬화한다.
   */
  private async isCapacityExceededLocked(
    tx: Prisma.TransactionClient,
    guard: DailyCapacityGuard,
    quantity: number,
  ): Promise<boolean> {
    const capacityRows = await tx.$queryRaw<{ capacity: number }[]>(Prisma.sql`
      SELECT capacity
      FROM store_daily_capacity
      WHERE store_id = ${guard.storeId}
        AND capacity_date = ${guard.dateOnlyUtc}
        AND deleted_at IS NULL
      FOR UPDATE
    `);
    const capacity = capacityRows[0]?.capacity;
    if (capacity === undefined) return false;

    const bookedRows = await tx.$queryRaw<{ booked: bigint }[]>(Prisma.sql`
      SELECT CAST(COALESCE(SUM(oi.quantity), 0) AS UNSIGNED) AS booked
      FROM order_item oi
      JOIN \`order\` o
        ON o.id = oi.order_id
        AND o.deleted_at IS NULL
        AND o.status <> 'CANCELED'
        AND o.pickup_at >= ${guard.dayStartUtc}
        AND o.pickup_at < ${guard.dayEndUtc}
      WHERE oi.store_id = ${guard.storeId}
        AND oi.deleted_at IS NULL
    `);
    const booked = Number(bookedRows[0]?.booked ?? 0);
    return booked + quantity > capacity;
  }

  private async insertSubmittedOrder(
    tx: Prisma.TransactionClient,
    args: CreateSubmittedOrderArgs,
  ): Promise<CreatedOrderRow> {
    return tx.order.create({
      data: {
        account_id: args.accountId,
        order_number: args.orderNumber,
        status: OrderStatus.SUBMITTED,
        pickup_at: args.pickupAt,
        buyer_name: args.buyerName,
        buyer_phone: args.buyerPhone,
        subtotal_price: args.subtotalPrice,
        discount_price: args.discountPrice,
        total_price: args.totalPrice,
        submitted_at: args.submittedAt,
        items: {
          create: {
            store_id: args.item.storeId,
            product_id: args.item.productId,
            product_name_snapshot: args.item.productNameSnapshot,
            regular_price_snapshot: args.item.regularPriceSnapshot,
            sale_price_snapshot: args.item.salePriceSnapshot,
            quantity: args.item.quantity,
            item_subtotal_price: args.item.itemSubtotalPrice,
            option_items: {
              create: args.item.options.map((option) => ({
                option_group_id: option.optionGroupId,
                option_item_id: option.optionItemId,
                group_name_snapshot: option.groupNameSnapshot,
                option_title_snapshot: option.optionTitleSnapshot,
                option_price_delta_snapshot: option.optionPriceDeltaSnapshot,
              })),
            },
          },
        },
        status_histories: {
          create: {
            from_status: null,
            to_status: OrderStatus.SUBMITTED,
            changed_at: args.submittedAt,
          },
        },
      },
      select: {
        id: true,
        order_number: true,
        status: true,
        pickup_at: true,
        total_price: true,
      },
    });
  }

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
          where: activeWhere,
          orderBy: { id: 'asc' },
          take: 1,
          include: {
            product: {
              select: {
                images: {
                  where: activeWhere,
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

  async findOrdersByAccount(args: {
    accountId: bigint;
    statuses?: OrderStatus[];
    offset: number;
    limit: number;
  }): Promise<MyOrderRow[]> {
    const where = {
      account_id: args.accountId,
      ...(args.statuses && args.statuses.length > 0
        ? { status: { in: args.statuses } }
        : {}),
    };

    return this.prisma.order.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: args.offset,
      take: args.limit,
      include: {
        items: {
          where: activeWhere,
          orderBy: { id: 'asc' },
          take: 1,
          include: {
            store: {
              select: { store_name: true },
            },
            product: {
              select: {
                images: {
                  where: activeWhere,
                  orderBy: { sort_order: 'asc' },
                  take: 1,
                  select: { image_url: true },
                },
              },
            },
          },
        },
        _count: {
          select: { items: { where: activeWhere } },
        },
      },
    });
  }

  async countOrdersByAccount(args: {
    accountId: bigint;
    statuses?: OrderStatus[];
  }): Promise<number> {
    return this.prisma.order.count({
      where: {
        account_id: args.accountId,
        ...(args.statuses && args.statuses.length > 0
          ? { status: { in: args.statuses } }
          : {}),
      },
    });
  }

  /**
   * 주어진 orderId 중 PICKED_UP 상태이며 active 리뷰가 미작성인 OrderItem을
   * 1건 이상 가진 order의 ID 집합을 반환한다.
   *
   * 주의: list 매핑에서 order별 개별 쿼리(N+1) 회피용. 단일 IN 쿼리로 처리.
   */
  async findReviewableOrderIds(args: {
    accountId: bigint;
    orderIds: bigint[];
  }): Promise<Set<string>> {
    if (args.orderIds.length === 0) return new Set();

    const rows = await this.prisma.orderItem.findMany({
      where: {
        order_id: { in: args.orderIds },
        order: {
          account_id: args.accountId,
          status: OrderStatus.PICKED_UP,
        },
        OR: [
          { review: { is: null } },
          { review: { is: { deleted_at: { not: null } } } },
        ],
      },
      select: { order_id: true },
      distinct: ['order_id'],
    });

    return new Set(rows.map((r) => r.order_id.toString()));
  }

  /**
   * 리뷰 작성 가능한 주문 아이템 페이지(마이페이지 '리뷰 남기기' 탭).
   * 조건은 canWriteReview/findReviewableOrderIds와 동일: 픽업 완료 + 활성 리뷰 미존재
   * (soft-delete된 리뷰는 재작성 가능으로 취급). 픽업 최신순 정렬.
   */
  async listReviewableOrderItems(args: {
    accountId: bigint;
    offset: number;
    limit: number;
  }): Promise<{ items: ReviewableOrderItemRow[]; totalCount: number }> {
    const where = {
      ...activeWhere,
      order: {
        account_id: args.accountId,
        status: OrderStatus.PICKED_UP,
        // soft-delete extension은 nested relation filter에 deleted_at을 주입하지
        // 않으므로 삭제된 주문의 아이템이 노출되지 않게 명시한다
        ...activeWhere,
      },
      OR: [
        { review: { is: null } },
        { review: { is: { deleted_at: { not: null } } } },
      ],
    };

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.orderItem.findMany({
        where,
        orderBy: [{ order: { picked_up_at: 'desc' } }, { id: 'desc' }],
        skip: args.offset,
        take: args.limit,
        select: {
          id: true,
          product_id: true,
          product_name_snapshot: true,
          order: { select: { picked_up_at: true } },
          product: {
            select: {
              images: {
                where: activeWhere,
                orderBy: { sort_order: 'asc' },
                take: 1,
                select: { image_url: true },
              },
            },
          },
          store: {
            select: {
              store_name: true,
              address_city: true,
              address_neighborhood: true,
              region: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.orderItem.count({ where }),
    ]);

    return { items, totalCount };
  }

  async findOrderDetailByAccount(args: { orderId: bigint; accountId: bigint }) {
    return this.prisma.order.findFirst({
      where: {
        id: args.orderId,
        account_id: args.accountId,
      },
      include: {
        status_histories: {
          where: activeWhere,
          orderBy: { changed_at: 'asc' },
        },
        items: {
          where: activeWhere,
          orderBy: { id: 'asc' },
          include: {
            store: {
              select: {
                id: true,
                store_name: true,
                store_phone: true,
                address_full: true,
                address_city: true,
                address_district: true,
                address_neighborhood: true,
                latitude: true,
                longitude: true,
                business_hours_text: true,
                website_url: true,
                business_hours: {
                  where: activeWhere,
                  orderBy: { day_of_week: 'asc' },
                },
              },
            },
            product: {
              select: {
                images: {
                  where: activeWhere,
                  orderBy: { sort_order: 'asc' },
                  take: 1,
                  select: { image_url: true },
                },
              },
            },
            option_items: {
              where: activeWhere,
              orderBy: { id: 'asc' },
            },
            custom_texts: {
              where: activeWhere,
              orderBy: { sort_order: 'asc' },
            },
            free_edits: {
              where: activeWhere,
              orderBy: { sort_order: 'asc' },
              include: {
                attachments: {
                  where: activeWhere,
                  orderBy: { sort_order: 'asc' },
                },
              },
            },
            review: {
              select: { id: true, deleted_at: true },
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
