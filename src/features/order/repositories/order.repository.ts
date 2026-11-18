import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { IN_PROGRESS_ORDER_STATUSES } from '@/features/order/constants/order-status-traits';
import { orderPaymentPendingEvent } from '@/features/order/events/order-payment-pending.event';
import { orderStatusChangedEvent } from '@/features/order/events/order-status-changed.event';
import {
  isDailyCapacityExceeded,
  type DailyCapacityGuard,
} from '@/features/order/repositories/order-capacity.helper';
import {
  lockCustomUploadsForAttach,
  markCustomUploadsAttached,
  type CustomUploadIssue,
  type CustomUploadRef,
} from '@/features/order/repositories/order-custom-upload-attach.helper';
import {
  countPendingPaymentOrdersLocked,
  PENDING_PAYMENT_LIMIT,
  withPendingPaymentLock,
} from '@/features/order/repositories/order-pending-payment-lock.helper';
import {
  confirmedPaidAmount,
  finalizeSettlementLocked,
  lockPayment,
} from '@/features/order/repositories/order-settlement-finalizer.helper';
import {
  orderPaymentSelect,
  type OrderPaymentRow,
} from '@/features/order/repositories/payment.repository';
import { OutboxPublisher } from '@/features/outbox';
import {
  AuditActionType,
  AuditTargetType,
  OrderActor,
  OrderStatus,
  PaymentMethod,
  Prisma,
  RefundKind,
  type AccountType,
  type CustomImageKind,
  type CustomMode,
  type CustomTextAlign,
  type PaymentStatus,
} from '@/generated/prisma/client';
import { activeWhere, PrismaService } from '@/prisma';

export type AdminOrderRow = Prisma.OrderGetPayload<{
  include: typeof adminOrderInclude;
}>;
export type AdminOrderDetailRow = Prisma.OrderGetPayload<{
  include: typeof adminOrderDetailInclude;
}>;
export type SellerOrderRow = Prisma.OrderGetPayload<{
  include: ReturnType<typeof sellerOrderSummaryInclude>;
}>;

/** 판매자에게 보이는 주문 — 입금 확인(접수) 때 submitted_at을 채우므로 입금 대기와 입금 전 취소가 함께 빠진다. */
const sellerVisibleWhere = {
  submitted_at: { not: null },
} satisfies Prisma.OrderWhereInput;

/** 주문 상세 3곳(구매자·판매자·관리자)의 픽업 변경 이력(오래된 순). */
const pickupChangesInclude = {
  orderBy: [{ changed_at: 'asc' }, { id: 'asc' }],
} satisfies Prisma.Order$pickup_changesArgs;

/** 주문 상세 3곳(구매자·판매자·관리자)의 커스텀 스냅샷. 디자인·이미지는 deleted_at이 없어 부모 품목 가시성을 따른다 */
const orderItemCustomInclude = {
  custom_design: { select: { schema_version: true, design_json: true } },
  // enum 선언 순서(3D 윗면·앞·뒤·좌·우, 슬롯형 합성)
  custom_images: { orderBy: { kind: 'asc' } },
  custom_texts: { where: activeWhere, orderBy: { sort_order: 'asc' } },
  free_edits: {
    where: activeWhere,
    orderBy: { sort_order: 'asc' },
    include: {
      attachments: { where: activeWhere, orderBy: { sort_order: 'asc' } },
    },
  },
} satisfies Prisma.OrderItemInclude;

export const adminOrderInclude = {
  items: {
    where: activeWhere,
    select: {
      store_id: true,
      store_name_snapshot: true,
      product_name_snapshot: true,
      product_thumbnail_url_snapshot: true,
      custom_mode_snapshot: true,
      custom_preview_image_url: true,
    },
    orderBy: { id: 'asc' },
    take: 1,
  },
} satisfies Prisma.OrderInclude;

/** 목록 카드용 첫 품목 스냅샷 — 매장 필터가 들어가 상수로 둘 수 없다. */
export function sellerOrderSummaryInclude(storeId: bigint) {
  return {
    items: {
      where: { store_id: storeId, ...activeWhere },
      select: {
        product_name_snapshot: true,
        product_thumbnail_url_snapshot: true,
        custom_mode_snapshot: true,
        custom_preview_image_url: true,
      },
      orderBy: { id: 'asc' },
      take: 1,
    },
  } satisfies Prisma.OrderInclude;
}

const adminOrderDetailInclude = {
  account: {
    select: {
      id: true,
      email: true,
      status: true,
      user_profile: { select: { nickname: true, deleted_at: true } },
    },
  },
  payment: true,
  refunds: { orderBy: { id: 'asc' } },
  pickup_changes: pickupChangesInclude,
  status_histories: { where: activeWhere, orderBy: { changed_at: 'desc' } },
  items: {
    where: activeWhere,
    orderBy: { id: 'asc' },
    include: {
      option_items: { where: activeWhere },
      ...orderItemCustomInclude,
    },
  },
} satisfies Prisma.OrderInclude;

export interface AdminOrderStatusCounts {
  pendingPayment: number;
  submitted: number;
  confirmed: number;
  made: number;
  pickedUp: number;
  noShow: number;
  canceled: number;
}

const ADMIN_STATUS_COUNT_KEYS = {
  PENDING_PAYMENT: 'pendingPayment',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  MADE: 'made',
  PICKED_UP: 'pickedUp',
  NO_SHOW: 'noShow',
  CANCELED: 'canceled',
} as const satisfies Record<OrderStatus, keyof AdminOrderStatusCounts>;

export interface MyOrderRow {
  id: bigint;
  order_number: string;
  status: OrderStatus;
  created_at: Date;
  pickup_at: Date;
  subtotal_price: number;
  discount_price: number;
  total_price: number;
  items: {
    product_name_snapshot: string;
    store_name_snapshot: string;
    store_region_label_snapshot: string | null;
    product_thumbnail_url_snapshot: string | null;
  }[];
  _count: { items: number };
  payment: { status: PaymentStatus; expires_at: Date } | null;
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
    product_thumbnail_url_snapshot: string | null;
  }[];
}

export type { DailyCapacityGuard } from '@/features/order/repositories/order-capacity.helper';

/** 주문 품목 커스텀 스냅샷. 검증·정규화를 마친 값이고, uploads는 같은 tx에서 잠가 ATTACHED로 바꿀 업로드다. */
export interface OrderItemCustomSnapshot {
  mode: Exclude<CustomMode, 'NONE'>;
  baseImageUrl: string | null;
  previewImageUrl: string;
  texts: {
    tokenId: bigint;
    tokenKey: string;
    label: string;
    defaultText: string;
    valueText: string | null;
    sortOrder: number;
    posX: number;
    posY: number;
    width: number;
    height: number;
    textColor: string;
    textAlign: CustomTextAlign;
  }[];
  freeEdits: {
    posX: number;
    posY: number;
    width: number;
    height: number;
    descriptionText: string;
    referenceImageUrls: string[];
  }[];
  design: { schemaVersion: number; json: Prisma.InputJsonObject } | null;
  images: { kind: CustomImageKind; imageUrl: string }[];
  uploads: CustomUploadRef[];
}

export interface CreatePendingPaymentOrderArgs {
  accountId: bigint;
  orderNumber: string;
  idempotencyKey: string;
  idempotencyInputHash: string;
  pickupAt: Date;
  buyerName: string;
  buyerPhone: string;
  requestNote: string | null;
  subtotalPrice: number;
  discountPrice: number;
  totalPrice: number;
  commissionRateBps: number;
  now: Date;
  /** null이면 capacity 원자 검사 생략 — 항상 전달 권장. */
  capacityGuard: DailyCapacityGuard | null;
  payment: {
    depositorName: string;
    depositBankCode: string;
    depositAccountNumber: string;
    depositAccountHolder: string;
    expiresAt: Date;
  };
  item: {
    storeId: bigint;
    productId: bigint;
    productNameSnapshot: string;
    storeNameSnapshot: string;
    storeRegionLabelSnapshot: string | null;
    productThumbnailUrlSnapshot: string | null;
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
    custom: OrderItemCustomSnapshot | null;
  };
}

export interface CreatedOrderRow {
  id: bigint;
  order_number: string;
  status: OrderStatus;
  pickup_at: Date;
  total_price: number;
  idempotency_input_hash: string | null;
  /** 결제 도입 전 주문은 null */
  payment: OrderPaymentRow | null;
}

const createdOrderSelect = {
  id: true,
  order_number: true,
  status: true,
  pickup_at: true,
  total_price: true,
  idempotency_input_hash: true,
  payment: { select: orderPaymentSelect },
} satisfies Prisma.OrderSelect;

export type CreatePendingPaymentOrderResult =
  | CreatedOrderRow
  | 'capacity-exceeded'
  | 'pending-limit'
  | 'lock-timeout'
  | CustomUploadIssue;

export interface ReviewableOrderItemRow {
  id: bigint;
  product_id: bigint;
  product_name_snapshot: string;
  store_name_snapshot: string;
  product_thumbnail_url_snapshot: string | null;
  order: { picked_up_at: Date | null } | null;
  /** 지역 표기만 현재 매장에서 읽는다(매장명은 스냅샷). */
  store: {
    address_city: string | null;
    address_neighborhood: string | null;
    region: { name: string } | null;
  } | null;
}

@Injectable()
export class OrderRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisher,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogs: IAuditLogRepository,
  ) {}

  /** USER 여부·프로필 활성 판정은 서비스가 한다(requireActiveUser와 동일 의미론). */
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
   * 입금 대기 주문을 결제(PENDING)와 함께 만든다. 계정 잠금(GET_LOCK) → 입금 대기 건수 → capacity → 커스텀 업로드 순으로 잠그고,
   * capacity는 행을 FOR UPDATE로 잠근 뒤 점유를 재집계해 동시 주문이 마지막 잔여를 함께 차지하지 못하게 한다.
   * order_number P2002는 호출부가 재시도한다.
   * READ COMMITTED: REPEATABLE READ의 갭 잠금은 다른 계정끼리도 건수 잠금 읽기 → INSERT에서 교착한다.
   */
  async createPendingPaymentOrder(
    args: CreatePendingPaymentOrderArgs,
  ): Promise<CreatePendingPaymentOrderResult> {
    return this.prisma.$transaction(
      (tx) =>
        withPendingPaymentLock(tx, this.prisma, args.accountId, async () => {
          const pending = await countPendingPaymentOrdersLocked(
            tx,
            args.accountId,
          );
          if (pending >= PENDING_PAYMENT_LIMIT) return 'pending-limit';
          if (args.capacityGuard) {
            const exceeded = await isDailyCapacityExceeded(
              tx,
              args.capacityGuard,
              args.item.quantity,
              { forUpdate: true },
            );
            if (exceeded) return 'capacity-exceeded';
          }
          const uploadIssue = await lockCustomUploadsForAttach(
            tx,
            args.accountId,
            args.item.custom?.uploads ?? [],
          );
          if (uploadIssue) return uploadIssue;
          return this.insertPendingPaymentOrder(tx, args);
        }),
      {
        timeout: 10_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  /** tx 밖 사전 검증(잠금 없음) — 거절을 tx 전에 내리고, 최종 판정은 createPendingPaymentOrder의 잠금 재검사가 한다. */
  async isDailyCapacityExceeded(
    guard: DailyCapacityGuard,
    quantity: number,
  ): Promise<boolean> {
    return isDailyCapacityExceeded(this.prisma, guard, quantity, {
      forUpdate: false,
    });
  }

  private async insertPendingPaymentOrder(
    tx: Prisma.TransactionClient,
    args: CreatePendingPaymentOrderArgs,
  ): Promise<CreatedOrderRow> {
    const created = await tx.order.create({
      data: {
        account_id: args.accountId,
        order_number: args.orderNumber,
        idempotency_key: args.idempotencyKey,
        idempotency_input_hash: args.idempotencyInputHash,
        status: OrderStatus.PENDING_PAYMENT,
        pickup_at: args.pickupAt,
        buyer_name: args.buyerName,
        buyer_phone: args.buyerPhone,
        request_note: args.requestNote,
        subtotal_price: args.subtotalPrice,
        discount_price: args.discountPrice,
        total_price: args.totalPrice,
        commission_rate_bps: args.commissionRateBps,
        items: {
          create: {
            store_id: args.item.storeId,
            product_id: args.item.productId,
            product_name_snapshot: args.item.productNameSnapshot,
            store_name_snapshot: args.item.storeNameSnapshot,
            store_region_label_snapshot: args.item.storeRegionLabelSnapshot,
            product_thumbnail_url_snapshot:
              args.item.productThumbnailUrlSnapshot,
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
            ...(args.item.custom && customItemData(args.item.custom)),
          },
        },
        payment: {
          create: {
            method: PaymentMethod.BANK_TRANSFER,
            amount: args.totalPrice,
            depositor_name: args.payment.depositorName,
            deposit_bank_code: args.payment.depositBankCode,
            deposit_account_number: args.payment.depositAccountNumber,
            deposit_account_holder: args.payment.depositAccountHolder,
            expires_at: args.payment.expiresAt,
          },
        },
        status_histories: {
          create: {
            from_status: null,
            to_status: OrderStatus.PENDING_PAYMENT,
            changed_at: args.now,
            actor_type: OrderActor.BUYER,
            actor_account_id: args.accountId,
          },
        },
      },
      select: createdOrderSelect,
    });
    await markCustomUploadsAttached(
      tx,
      args.item.custom?.uploads ?? [],
      args.now,
    );
    // 관리자 경보 원천. 판매자 '새 주문'(order.submitted)은 입금 확인 때 나간다
    await this.outbox.publish(
      tx,
      orderPaymentPendingEvent({
        orderId: created.id,
        orderNumber: created.order_number,
        buyerAccountId: args.accountId,
        amount: args.totalPrice,
        depositorName: args.payment.depositorName,
        expiresAt: args.payment.expiresAt,
        occurredAt: args.now,
      }),
    );
    return created;
  }

  /** 상태가 이후 변경됐어도 현재 row를 그대로 반환한다(replay 응답 재구성용). */
  async findOrderByIdempotencyKey(
    accountId: bigint,
    idempotencyKey: string,
  ): Promise<CreatedOrderRow | null> {
    return this.prisma.order.findFirst({
      where: { account_id: accountId, idempotency_key: idempotencyKey },
      select: createdOrderSelect,
    });
  }

  /**
   * MySQL unique(uk_order_account_idempotency)는 deleted_at을 보지 않으므로 삭제된 주문도 키를 계속 점유한다 —
   * 같은 키로는 영영 생성이 불가하다. soft-delete 포함 조회가 목적이라 extension의 활성 필터를 우회한다.
   */
  async existsDeletedOrderWithIdempotencyKey(
    accountId: bigint,
    idempotencyKey: string,
  ): Promise<boolean> {
    const found = await this.prisma.order.findFirst({
      where: {
        account_id: accountId,
        idempotency_key: idempotencyKey,
        deleted_at: { not: null },
      },
      select: { id: true },
    });
    return found !== null;
  }

  async findOngoingOrdersByAccount(args: {
    accountId: bigint;
    since: Date;
    limit: number;
  }): Promise<OngoingOrderRow[]> {
    return this.prisma.order.findMany({
      where: {
        account_id: args.accountId,
        status: { in: [...IN_PROGRESS_ORDER_STATUSES] },
        created_at: { gte: args.since },
      },
      orderBy: { created_at: 'desc' },
      take: args.limit,
      include: {
        items: {
          where: activeWhere,
          orderBy: { id: 'asc' },
          take: 1,
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
        },
        _count: {
          select: { items: { where: activeWhere } },
        },
        payment: { select: { status: true, expires_at: true } },
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

  /** 목록 매핑의 order별 개별 쿼리(N+1)를 피하려고 단일 IN 쿼리로 집계한다. */
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
          // 삭제된 주문의 아이템이 리뷰 가능으로 집계되지 않게 명시
          // (listReviewableOrderItems와 동일 가드)
          ...activeWhere,
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

  /** 조건은 canWriteReview/findReviewableOrderIds와 동일(soft-delete된 리뷰는 재작성 가능으로 취급). */
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
          store_name_snapshot: true,
          product_thumbnail_url_snapshot: true,
          order: { select: { picked_up_at: true } },
          store: {
            select: {
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
        payment: { select: orderPaymentSelect },
        refunds: { orderBy: { id: 'asc' } },
        pickup_changes: pickupChangesInclude,
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
            option_items: {
              where: activeWhere,
              orderBy: { id: 'asc' },
            },
            ...orderItemCustomInclude,
            review: {
              select: { id: true, deleted_at: true },
            },
          },
        },
      },
    });
  }

  /** 목록과 카운트가 같은 조건을 보도록 한 곳에서 만든다(커서 제외). */
  private storeOrderScopeWhere(args: {
    storeId: bigint;
    status?: OrderStatus;
    buyerAccountId?: bigint;
    fromCreatedAt?: Date;
    toCreatedAt?: Date;
    fromPickupAt?: Date;
    toPickupAt?: Date;
    search?: string;
  }): Prisma.OrderWhereInput {
    return {
      ...sellerVisibleWhere,
      ...(args.status ? { status: args.status } : {}),
      ...(args.buyerAccountId !== undefined
        ? { account_id: args.buyerAccountId }
        : {}),
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
          ...activeWhere,
        },
      },
    };
  }

  async countOrdersByStore(args: {
    storeId: bigint;
    status?: OrderStatus;
    buyerAccountId?: bigint;
    fromCreatedAt?: Date;
    toCreatedAt?: Date;
    fromPickupAt?: Date;
    toPickupAt?: Date;
    search?: string;
  }): Promise<number> {
    return this.prisma.order.count({
      where: this.storeOrderScopeWhere(args),
    });
  }

  /** [from, to) 픽업 또는 접수 기준 건수·금액 합(판매자 노출·CANCELED 제외). 주문 1건 = 매장 1곳이라 total_price 합이 매장 매출이다. */
  async aggregateStoreOrdersInRange(args: {
    storeId: bigint;
    from: Date;
    to: Date;
    basis: 'pickup' | 'submitted';
  }): Promise<{ orderCount: number; salesAmount: number }> {
    const result = await this.prisma.order.aggregate({
      where: {
        // 접수 기준 범위가 노출 조건의 submitted_at 키를 덮어쓰지 않도록 AND로 묶는다
        AND: [
          sellerVisibleWhere,
          {
            [args.basis === 'pickup' ? 'pickup_at' : 'submitted_at']: {
              gte: args.from,
              lt: args.to,
            },
          },
        ],
        status: { not: 'CANCELED' },
        items: { some: { store_id: args.storeId, ...activeWhere } },
      },
      _count: { _all: true },
      _sum: { total_price: true },
    });
    return {
      orderCount: result._count._all,
      salesAmount: result._sum.total_price ?? 0,
    };
  }

  /** [from, to) 픽업 입금 대기 주문의 제작 수량 합. 판매자에게 주문은 숨기고 점유한 수량만 알린다. */
  async sumPendingPaymentQuantityByStore(args: {
    storeId: bigint;
    from: Date;
    to: Date;
  }): Promise<number> {
    const result = await this.prisma.orderItem.aggregate({
      where: {
        store_id: args.storeId,
        order: {
          status: OrderStatus.PENDING_PAYMENT,
          pickup_at: { gte: args.from, lt: args.to },
          ...activeWhere,
        },
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  async listOrdersByStore(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
    status?: OrderStatus;
    buyerAccountId?: bigint;
    fromCreatedAt?: Date;
    toCreatedAt?: Date;
    fromPickupAt?: Date;
    toPickupAt?: Date;
    search?: string;
  }): Promise<SellerOrderRow[]> {
    return this.prisma.order.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.storeOrderScopeWhere(args),
      },
      include: sellerOrderSummaryInclude(args.storeId),
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async findOrderDetailByStore(args: { orderId: bigint; storeId: bigint }) {
    return this.prisma.order.findFirst({
      where: {
        id: args.orderId,
        ...sellerVisibleWhere,
        items: {
          some: {
            store_id: args.storeId,
            ...activeWhere,
          },
        },
      },
      // 유저측 상세(findOrderDetailByUser)와 동일하게 soft-delete 자식을 가드한다
      include: {
        payment: { select: { method: true } },
        // 입금 반환은 구매자와 플랫폼 사이 일이라 취소 환불만 본다
        refunds: { where: { kind: RefundKind.CANCEL } },
        pickup_changes: pickupChangesInclude,
        // 입금 대기 이력은 판매자에게 보이지 않는다
        status_histories: {
          where: {
            to_status: { not: OrderStatus.PENDING_PAYMENT },
            ...activeWhere,
          },
          orderBy: {
            changed_at: 'desc',
          },
        },
        items: {
          where: {
            store_id: args.storeId,
            ...activeWhere,
          },
          include: {
            option_items: { where: activeWhere },
            ...orderItemCustomInclude,
          },
        },
      },
    });
  }

  /**
   * 판매자 상태 변경. 주문 행을 잠근(FOR UPDATE) 뒤 잠금 시점 상태로 전이를 다시 판정한다 —
   * 취소(OrderTransitionRepository.cancelLocked)와 같은 잠금을 쓰므로 둘이 교차해도 나중 쪽은 바뀐
   * 상태를 보고 거절된다(잠금 없이 읽으면 CANCELED 위에 CONFIRMED를 덮어쓴다). 픽업 완료·노쇼는 정산을 함께 확정한다.
   * assertTransition은 잠금 시점 상태·픽업 시각으로 부르고, 던지면 트랜잭션은 롤백되고 예외가 그대로 전파된다.
   */
  async updateOrderStatusBySeller(args: {
    orderId: bigint;
    storeId: bigint;
    actorAccountId: bigint;
    toStatus: OrderStatus;
    note: string | null;
    now: Date;
    assertTransition: (fromStatus: OrderStatus, pickupAt: Date) => void;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        {
          id: bigint;
          status: OrderStatus;
          pickup_at: Date;
          commission_rate_bps: number;
        }[]
      >`
        SELECT o.id, o.status, o.pickup_at, o.commission_rate_bps FROM \`order\` o
        WHERE o.id = ${args.orderId} AND o.deleted_at IS NULL
          AND o.submitted_at IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM order_item i
            WHERE i.order_id = o.id AND i.store_id = ${args.storeId}
          )
        FOR UPDATE OF o`;
      const order = locked[0];

      if (!order) {
        return null;
      }

      const fromStatus = order.status;
      args.assertTransition(fromStatus, order.pickup_at);

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
          ...(args.toStatus === OrderStatus.NO_SHOW
            ? { no_show_at: args.now }
            : {}),
        },
        include: sellerOrderSummaryInclude(args.storeId),
      });
      if (
        args.toStatus === OrderStatus.PICKED_UP ||
        args.toStatus === OrderStatus.NO_SHOW
      ) {
        const payment = await lockPayment(tx, order.id);
        await finalizeSettlementLocked(
          tx,
          order,
          confirmedPaidAmount(payment),
          args.now,
        );
      }

      await tx.orderStatusHistory.create({
        data: {
          order_id: order.id,
          from_status: fromStatus,
          to_status: args.toStatus,
          changed_at: args.now,
          actor_type: OrderActor.SELLER,
          actor_account_id: args.actorAccountId,
          note: args.note,
        },
      });

      // 상태 전이 이벤트(outbox, 같은 tx) — 알림은 notification 소비자가 만든다. payload는 생산 시점 스냅샷.
      // 주문은 단일 상품 구조라 첫 item으로 상품이 확정된다(다상품 확장 시 재검토).
      const firstItem = await tx.orderItem.findFirst({
        where: { order_id: order.id },
        orderBy: { id: 'asc' },
        select: {
          product_id: true,
          product_name_snapshot: true,
          store_name_snapshot: true,
        },
      });
      await this.outbox.publish(
        tx,
        orderStatusChangedEvent({
          orderId: order.id,
          orderNumber: updatedOrder.order_number,
          buyerAccountId: updatedOrder.account_id,
          fromStatus,
          toStatus: args.toStatus,
          storeId: args.storeId,
          storeName: firstItem?.store_name_snapshot ?? null,
          productId: firstItem?.product_id ?? null,
          productName: firstItem?.product_name_snapshot ?? null,
          actorType: OrderActor.SELLER,
          pickupAt: updatedOrder.pickup_at,
          occurredAt: args.now,
          actorAccountId: args.actorAccountId,
        }),
      );

      // 감사 기록은 라이브러리(포트)를 통해서만 남긴다 — ip/ua는 넘긴 값이 없으면 요청 컨텍스트에서 보강된다
      await this.auditLogs.recordAudit(tx, {
        actorAccountId: args.actorAccountId,
        storeId: args.storeId,
        targetType: AuditTargetType.ORDER,
        targetId: order.id,
        action: AuditActionType.STATUS_CHANGE,
        beforeJson: {
          status: fromStatus,
        },
        afterJson: {
          status: args.toStatus,
          note: args.note,
        },
        ...(args.ipAddress ? { ipAddress: args.ipAddress } : {}),
        ...(args.userAgent ? { userAgent: args.userAgent } : {}),
      });

      return updatedOrder;
    });
  }

  // ── 관리자 ──

  /** 목록과 카운트가 같은 조건을 보도록 한 곳에서 만든다. */
  private adminOrderScopeWhere(args: {
    keyword?: string;
    status?: OrderStatus;
    inProgress?: boolean;
    storeId?: bigint;
    accountId?: bigint;
    fromCreatedAt?: Date;
    toCreatedAt?: Date;
  }): Prisma.OrderWhereInput {
    return {
      // status와 함께 오면 AND — 둘이 겹치지 않으면 빈 결과다
      AND: [
        args.status ? { status: args.status } : {},
        args.inProgress
          ? { status: { in: [...IN_PROGRESS_ORDER_STATUSES] } }
          : {},
      ],
      ...(args.accountId !== undefined ? { account_id: args.accountId } : {}),
      ...(args.storeId !== undefined
        ? { items: { some: { store_id: args.storeId, ...activeWhere } } }
        : {}),
      ...(args.fromCreatedAt || args.toCreatedAt
        ? {
            created_at: {
              ...(args.fromCreatedAt ? { gte: args.fromCreatedAt } : {}),
              ...(args.toCreatedAt ? { lte: args.toCreatedAt } : {}),
            },
          }
        : {}),
      ...(args.keyword
        ? {
            OR: [
              { order_number: { contains: args.keyword } },
              { buyer_name: { contains: args.keyword } },
              { buyer_phone: { contains: args.keyword } },
            ],
          }
        : {}),
    };
  }

  async listOrdersForAdmin(args: {
    keyword?: string;
    status?: OrderStatus;
    inProgress?: boolean;
    storeId?: bigint;
    accountId?: bigint;
    fromCreatedAt?: Date;
    toCreatedAt?: Date;
    limit: number;
    cursor?: bigint;
  }): Promise<AdminOrderRow[]> {
    return this.prisma.order.findMany({
      where: {
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...this.adminOrderScopeWhere(args),
      },
      include: adminOrderInclude,
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async countOrdersForAdmin(args: {
    keyword?: string;
    status?: OrderStatus;
    inProgress?: boolean;
    storeId?: bigint;
    accountId?: bigint;
    fromCreatedAt?: Date;
    toCreatedAt?: Date;
  }): Promise<number> {
    return this.prisma.order.count({ where: this.adminOrderScopeWhere(args) });
  }

  async findOrderDetailForAdmin(
    orderId: bigint,
  ): Promise<AdminOrderDetailRow | null> {
    return this.prisma.order.findFirst({
      where: { id: orderId },
      include: adminOrderDetailInclude,
    });
  }

  /** 매장의 진행 중 주문 상태별 건수(관리자 정지·숨김 경고용). 0건 상태는 빼고 흐름 순으로 돌려준다. */
  async countInProgressOrdersByStore(
    storeId: bigint,
  ): Promise<{ status: OrderStatus; count: number }[]> {
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: {
        status: { in: [...IN_PROGRESS_ORDER_STATUSES] },
        items: { some: { store_id: storeId, ...activeWhere } },
      },
      _count: { _all: true },
    });
    const counts = new Map(grouped.map((g) => [g.status, g._count._all]));
    return IN_PROGRESS_ORDER_STATUSES.flatMap((status) => {
      const count = counts.get(status);
      return count ? [{ status, count }] : [];
    });
  }

  // ── 대시보드 집계(dashboard feature가 배럴로 소비) ──

  /** 금액 합은 돈이 오가지 않은 취소·입금 대기를 뺀다. */
  async aggregateOrdersBetween(
    from: Date,
    to: Date,
  ): Promise<{ counts: AdminOrderStatusCounts; amountSum: number }> {
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: { created_at: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { total_price: true },
    });
    const counts: AdminOrderStatusCounts = {
      pendingPayment: 0,
      submitted: 0,
      confirmed: 0,
      made: 0,
      pickedUp: 0,
      noShow: 0,
      canceled: 0,
    };
    let amountSum = 0;
    for (const g of grouped) {
      counts[ADMIN_STATUS_COUNT_KEYS[g.status]] = g._count._all;
      if (g.status !== 'CANCELED' && g.status !== 'PENDING_PAYMENT') {
        amountSum += g._sum.total_price ?? 0;
      }
    }
    return { counts, amountSum };
  }
}

/** 품목 생성에 펼쳐 넣는 커스텀 스냅샷. 자유 편집·참고 사진 순서는 입력 순서다. */
function customItemData(custom: OrderItemCustomSnapshot) {
  return {
    custom_mode_snapshot: custom.mode,
    custom_base_image_url_snapshot: custom.baseImageUrl,
    custom_preview_image_url: custom.previewImageUrl,
    custom_texts: {
      create: custom.texts.map((text) => ({
        token_id: text.tokenId,
        token_key_snapshot: text.tokenKey,
        label_snapshot: text.label,
        default_text_snapshot: text.defaultText,
        value_text: text.valueText,
        sort_order: text.sortOrder,
        pos_x: text.posX,
        pos_y: text.posY,
        width: text.width,
        height: text.height,
        text_color: text.textColor,
        text_align: text.textAlign,
      })),
    },
    free_edits: {
      create: custom.freeEdits.map((edit, index) => ({
        pos_x: edit.posX,
        pos_y: edit.posY,
        width: edit.width,
        height: edit.height,
        description_text: edit.descriptionText,
        sort_order: index,
        attachments: {
          create: edit.referenceImageUrls.map((url, order) => ({
            image_url: url,
            sort_order: order,
          })),
        },
      })),
    },
    custom_images: {
      create: custom.images.map((image) => ({
        kind: image.kind,
        image_url: image.imageUrl,
      })),
    },
    ...(custom.design && {
      custom_design: {
        create: {
          schema_version: custom.design.schemaVersion,
          design_json: custom.design.json,
        },
      },
    }),
  };
}
