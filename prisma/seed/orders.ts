/**
 * 시드 주문 + 아이템 + 상태 히스토리.
 *
 * user1 기준 11건. o1~o6은 결제 도입 전 주문(결제 기록 없음), o7~o11은 입금 흐름을 거친 주문이다
 * (결제·환불·입금 기록은 seedPayments가 붙인다):
 *   o1 SUBMITTED  - p1×1
 *   o2 CONFIRMED  - p2×1 + selectedOptions(레귤러)
 *   o3 MADE       - p3×2
 *   o4 PICKED_UP  - p1×1 (리뷰 작성됨 → hasReviewableItem=false, hasMyReview=true)
 *   o5 PICKED_UP  - p4×1 (리뷰 미작성 → hasReviewableItem=true)
 *   o6 CANCELED   - p2×1
 *   o7 PENDING_PAYMENT - p1×1 (입금 대기, 판매자 비노출)
 *   o8 NO_SHOW    - p3×1 (정산 확정)
 *   o9 CANCELED   - p2×1 (확정 뒤 구매자 사정 취소, 부분 환불 20,000원 + 잔액 정산 확정)
 *   o10 CANCELED  - p1×1 (미입금 자동 취소 뒤 늦은 입금 → 반환 대상)
 *   o11 SUBMITTED - p1×1 (입금 확인으로 접수, 확정 마감 있음)
 */
import type { SeededStores } from './stores';
import type { SeededUser } from './users';

import { buildRegionLabel } from '@/common/utils/region-label';
import type {
  OrderActor,
  OrderCancelFault,
  OrderCancelReason,
  OrderStatus,
  PrismaClient,
  Product,
} from '@/generated/prisma/client';
import { activeWhere } from '@/prisma';

/** 주문 시점 썸네일 스냅샷 — 주문 생성 경로와 같은 규칙(활성 첫 이미지). */
async function firstImageUrl(
  prisma: PrismaClient,
  productId: bigint,
): Promise<string | null> {
  const image = await prisma.productImage.findFirst({
    where: { product_id: productId, ...activeWhere },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
  });
  return image?.image_url ?? null;
}

/** 주문 시점 지역 표기 스냅샷 — 주문 생성 경로와 같은 규칙(buildRegionLabel). */
async function regionLabelOf(
  prisma: PrismaClient,
  storeId: bigint,
): Promise<string | null> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    include: { region: { select: { name: true } } },
  });
  return buildRegionLabel(store);
}

export interface SeededOrders {
  o1Submitted: bigint;
  o2Confirmed: bigint;
  o3Made: bigint;
  o4PickedUpReviewed: bigint;
  o4OrderItemId: bigint;
  o5PickedUpReviewable: bigint;
  o6Canceled: bigint;
  o7PendingPayment: bigint;
  o8NoShow: bigint;
  o9PartialRefund: bigint;
  o10UnpaidCanceled: bigint;
  o11PaidSubmitted: bigint;
}

interface FlowStep {
  to: OrderStatus;
  at: Date;
  actor: OrderActor;
  cancel?: {
    reason: OrderCancelReason;
    fault?: OrderCancelFault;
    refundAmount: number;
  };
}

export async function seedOrders(
  prisma: PrismaClient,
  ctx: { users: SeededUser[]; stores: SeededStores },
): Promise<SeededOrders> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedOrders');
  const [storeA, storeB] = ctx.stores.stores;
  const [p1, p2, p3, p4] = ctx.stores.products;
  const regionA = await regionLabelOf(prisma, storeA.id);
  const regionB = await regionLabelOf(prisma, storeB.id);
  const { p2GroupId, p2OptionItemId } = ctx.stores.optionGroupIds;

  const day = 24 * 60 * 60 * 1000;
  const now = new Date();
  const buyerName = user1.name ?? '테스트 유저';
  const buyerPhone = '010-1111-2222';

  // ── o1: SUBMITTED (방금 주문) ──
  const o1 = await prisma.order.create({
    data: {
      order_number: 'SEED-O1-SUB',
      account_id: user1.id,
      status: 'SUBMITTED',
      pickup_at: new Date(now.getTime() + 3 * day),
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      subtotal_price: 40000,
      discount_price: 5000,
      total_price: 35000,
      submitted_at: now,
      items: {
        create: [
          {
            store_id: storeA.id,
            product_id: p1.id,
            product_name_snapshot: p1.name,
            store_name_snapshot: storeA.store_name,
            store_region_label_snapshot: regionA,
            product_thumbnail_url_snapshot: await firstImageUrl(prisma, p1.id),
            regular_price_snapshot: p1.regular_price,
            sale_price_snapshot: p1.sale_price,
            quantity: 1,
            item_subtotal_price: 35000,
          },
        ],
      },
      status_histories: {
        create: [
          {
            from_status: null,
            to_status: 'SUBMITTED',
            changed_at: now,
            actor_type: 'BUYER',
          },
        ],
      },
    },
  });

  // ── o2: CONFIRMED (어제 확정) ──
  const o2SubmittedAt = new Date(now.getTime() - 2 * day);
  const o2ConfirmedAt = new Date(now.getTime() - 1 * day);
  const o2 = await prisma.order.create({
    data: {
      order_number: 'SEED-O2-CONF',
      account_id: user1.id,
      status: 'CONFIRMED',
      pickup_at: new Date(now.getTime() + 4 * day),
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      subtotal_price: 60000,
      discount_price: 0,
      total_price: 60000,
      submitted_at: o2SubmittedAt,
      confirmed_at: o2ConfirmedAt,
      status_histories: {
        create: [
          {
            from_status: null,
            to_status: 'SUBMITTED',
            changed_at: o2SubmittedAt,
            actor_type: 'BUYER',
          },
          {
            from_status: 'SUBMITTED',
            to_status: 'CONFIRMED',
            changed_at: o2ConfirmedAt,
            actor_type: 'SELLER',
          },
        ],
      },
    },
  });
  const o2Item = await prisma.orderItem.create({
    data: {
      order_id: o2.id,
      store_id: storeA.id,
      product_id: p2.id,
      product_name_snapshot: p2.name,
      store_name_snapshot: storeA.store_name,
      store_region_label_snapshot: regionA,
      product_thumbnail_url_snapshot: await firstImageUrl(prisma, p2.id),
      regular_price_snapshot: p2.regular_price,
      sale_price_snapshot: p2.sale_price,
      quantity: 1,
      item_subtotal_price: 60000,
    },
  });
  await prisma.orderItemOptionItem.create({
    data: {
      order_item_id: o2Item.id,
      option_group_id: p2GroupId,
      option_item_id: p2OptionItemId,
      group_name_snapshot: '케이크 사이즈',
      option_title_snapshot: '레귤러 (6호)',
      option_price_delta_snapshot: 10000,
    },
  });
  // 커스텀 텍스트 1건 + 자유 편집 1건 (주문 상세 검증용)
  await prisma.orderItemCustomText.create({
    data: {
      order_item_id: o2Item.id,
      token_key_snapshot: 'message',
      default_text_snapshot: '메시지를 입력하세요',
      value_text: '생일 축하해 :)',
      sort_order: 0,
    },
  });
  const o2FreeEdit = await prisma.orderItemCustomFreeEdit.create({
    data: {
      order_item_id: o2Item.id,
      crop_image_url: 'https://placehold.co/300x300/png?text=Custom+Crop',
      description_text: '이 사진을 케이크 위에 그려주세요',
      sort_order: 0,
    },
  });
  await prisma.orderItemCustomFreeEditAttachment.create({
    data: {
      free_edit_id: o2FreeEdit.id,
      image_url: 'https://placehold.co/300x300/png?text=Reference',
      sort_order: 0,
    },
  });

  // ── o3: MADE (제작 완료, 픽업 임박) ──
  const o3Submitted = new Date(now.getTime() - 4 * day);
  const o3Confirmed = new Date(now.getTime() - 3 * day);
  const o3Made = new Date(now.getTime() - 1 * day);
  const o3 = await prisma.order.create({
    data: {
      order_number: 'SEED-O3-MADE',
      account_id: user1.id,
      status: 'MADE',
      pickup_at: new Date(now.getTime() + 1 * day),
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      subtotal_price: 50000,
      discount_price: 6000,
      total_price: 44000,
      submitted_at: o3Submitted,
      confirmed_at: o3Confirmed,
      made_at: o3Made,
      items: {
        create: [
          {
            store_id: storeA.id,
            product_id: p3.id,
            product_name_snapshot: p3.name,
            store_name_snapshot: storeA.store_name,
            store_region_label_snapshot: regionA,
            product_thumbnail_url_snapshot: await firstImageUrl(prisma, p3.id),
            regular_price_snapshot: p3.regular_price,
            sale_price_snapshot: p3.sale_price,
            quantity: 2,
            item_subtotal_price: 44000,
          },
        ],
      },
      status_histories: {
        create: [
          {
            to_status: 'SUBMITTED',
            changed_at: o3Submitted,
            actor_type: 'BUYER',
          },
          {
            from_status: 'SUBMITTED',
            to_status: 'CONFIRMED',
            changed_at: o3Confirmed,
            actor_type: 'SELLER',
          },
          {
            from_status: 'CONFIRMED',
            to_status: 'MADE',
            changed_at: o3Made,
            actor_type: 'SELLER',
          },
        ],
      },
    },
  });

  // ── o4: PICKED_UP (리뷰 작성 완료) ──
  const o4Sub = new Date(now.getTime() - 14 * day);
  const o4Conf = new Date(now.getTime() - 13 * day);
  const o4Made = new Date(now.getTime() - 11 * day);
  const o4Picked = new Date(now.getTime() - 10 * day);
  const o4 = await prisma.order.create({
    data: {
      order_number: 'SEED-O4-PICKED-RE',
      account_id: user1.id,
      status: 'PICKED_UP',
      pickup_at: o4Picked,
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      subtotal_price: 40000,
      discount_price: 5000,
      total_price: 35000,
      submitted_at: o4Sub,
      confirmed_at: o4Conf,
      made_at: o4Made,
      picked_up_at: o4Picked,
      status_histories: {
        create: [
          {
            to_status: 'SUBMITTED',
            changed_at: o4Sub,
            actor_type: 'BUYER',
          },
          {
            from_status: 'SUBMITTED',
            to_status: 'CONFIRMED',
            changed_at: o4Conf,
            actor_type: 'SELLER',
          },
          {
            from_status: 'CONFIRMED',
            to_status: 'MADE',
            changed_at: o4Made,
            actor_type: 'SELLER',
          },
          {
            from_status: 'MADE',
            to_status: 'PICKED_UP',
            changed_at: o4Picked,
            actor_type: 'SELLER',
          },
        ],
      },
    },
  });
  const o4Item = await prisma.orderItem.create({
    data: {
      order_id: o4.id,
      store_id: storeA.id,
      product_id: p1.id,
      product_name_snapshot: p1.name,
      store_name_snapshot: storeA.store_name,
      store_region_label_snapshot: regionA,
      product_thumbnail_url_snapshot: await firstImageUrl(prisma, p1.id),
      regular_price_snapshot: p1.regular_price,
      sale_price_snapshot: p1.sale_price,
      quantity: 1,
      item_subtotal_price: 35000,
    },
  });
  // o4에는 리뷰가 달리므로(seedReviews) 커스텀 크롭을 함께 둬
  // 홈 제작 후기 쇼케이스(Before/After 페어)가 로컬에서 동작하게 한다
  await prisma.orderItemCustomFreeEdit.create({
    data: {
      order_item_id: o4Item.id,
      crop_image_url: 'https://placehold.co/300x300/png?text=Requested+Design',
      description_text: '이 그림처럼 레터링해 주세요',
      sort_order: 0,
    },
  });

  // ── o5: PICKED_UP (리뷰 미작성 → hasReviewableItem=true) ──
  const o5Picked = new Date(now.getTime() - 5 * day);
  const o5 = await prisma.order.create({
    data: {
      order_number: 'SEED-O5-PICKED-OK',
      account_id: user1.id,
      status: 'PICKED_UP',
      pickup_at: o5Picked,
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      subtotal_price: 3000,
      discount_price: 0,
      total_price: 3000,
      submitted_at: new Date(now.getTime() - 8 * day),
      confirmed_at: new Date(now.getTime() - 7 * day),
      made_at: new Date(now.getTime() - 6 * day),
      picked_up_at: o5Picked,
      items: {
        create: [
          {
            store_id: storeB.id,
            product_id: p4.id,
            product_name_snapshot: p4.name,
            store_name_snapshot: storeB.store_name,
            store_region_label_snapshot: regionB,
            product_thumbnail_url_snapshot: await firstImageUrl(prisma, p4.id),
            regular_price_snapshot: p4.regular_price,
            sale_price_snapshot: null,
            quantity: 1,
            item_subtotal_price: 3000,
          },
        ],
      },
      status_histories: {
        create: [
          {
            to_status: 'SUBMITTED',
            changed_at: new Date(now.getTime() - 8 * day),
            actor_type: 'BUYER',
          },
          {
            from_status: 'SUBMITTED',
            to_status: 'CONFIRMED',
            changed_at: new Date(now.getTime() - 7 * day),
            actor_type: 'SELLER',
          },
          {
            from_status: 'CONFIRMED',
            to_status: 'MADE',
            changed_at: new Date(now.getTime() - 6 * day),
            actor_type: 'SELLER',
          },
          {
            from_status: 'MADE',
            to_status: 'PICKED_UP',
            changed_at: o5Picked,
            actor_type: 'SELLER',
          },
        ],
      },
    },
  });

  // ── o6: CANCELED ──
  const o6Sub = new Date(now.getTime() - 6 * day);
  const o6Cancel = new Date(now.getTime() - 5 * day);
  const o6 = await prisma.order.create({
    data: {
      order_number: 'SEED-O6-CANCEL',
      account_id: user1.id,
      status: 'CANCELED',
      pickup_at: new Date(now.getTime() - 3 * day),
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      subtotal_price: 50000,
      discount_price: 0,
      total_price: 50000,
      submitted_at: o6Sub,
      canceled_at: o6Cancel,
      items: {
        create: [
          {
            store_id: storeA.id,
            product_id: p2.id,
            product_name_snapshot: p2.name,
            store_name_snapshot: storeA.store_name,
            store_region_label_snapshot: regionA,
            product_thumbnail_url_snapshot: await firstImageUrl(prisma, p2.id),
            regular_price_snapshot: p2.regular_price,
            sale_price_snapshot: null,
            quantity: 1,
            item_subtotal_price: 50000,
          },
        ],
      },
      status_histories: {
        create: [
          {
            to_status: 'SUBMITTED',
            changed_at: o6Sub,
            actor_type: 'BUYER',
          },
          {
            from_status: 'SUBMITTED',
            to_status: 'CANCELED',
            changed_at: o6Cancel,
            actor_type: 'SELLER',
            cancel_reason: 'OTHER',
            refund_amount: 0,
            note: '재료 수급 불가',
          },
        ],
      },
    },
  });

  // ── o7~o11: 입금 흐름(입금 대기 → 관리자 입금 확인 → 접수)을 거친 주문 ──
  const storeAContext = {
    accountId: user1.id,
    buyerName,
    buyerPhone,
    storeId: storeA.id,
    storeName: storeA.store_name,
    regionLabel: regionA,
  };
  const hour = 60 * 60 * 1000;
  const o7 = await createFlowOrder(prisma, {
    ...storeAContext,
    orderNumber: 'SEED-O7-PENDING',
    product: p1,
    pickupAt: new Date(now.getTime() + 5 * day),
    steps: [{ to: 'PENDING_PAYMENT', at: now, actor: 'BUYER' }],
  });

  const o8At = (h: number) => new Date(now.getTime() - 4 * day + h * hour);
  const o8 = await createFlowOrder(prisma, {
    ...storeAContext,
    orderNumber: 'SEED-O8-NOSHOW',
    product: p3,
    pickupAt: o8At(72),
    steps: [
      { to: 'PENDING_PAYMENT', at: o8At(0), actor: 'BUYER' },
      { to: 'SUBMITTED', at: o8At(0.5), actor: 'ADMIN' },
      { to: 'CONFIRMED', at: o8At(2), actor: 'SELLER' },
      { to: 'MADE', at: o8At(70), actor: 'SELLER' },
      { to: 'NO_SHOW', at: o8At(74), actor: 'SELLER' },
    ],
    // 노쇼는 픽업 완료와 같이 결제액 전체로 정산 확정
    settlement: { baseAmount: p3.regular_price, at: o8At(74) },
  });

  const o9At = (h: number) => new Date(now.getTime() - 3 * day + h * hour);
  const o9Refund = 20000;
  const o9 = await createFlowOrder(prisma, {
    ...storeAContext,
    orderNumber: 'SEED-O9-PARTIAL',
    product: p2,
    pickupAt: new Date(now.getTime() + 2 * day),
    steps: [
      { to: 'PENDING_PAYMENT', at: o9At(0), actor: 'BUYER' },
      { to: 'SUBMITTED', at: o9At(0.5), actor: 'ADMIN' },
      { to: 'CONFIRMED', at: o9At(3), actor: 'SELLER' },
      {
        to: 'CANCELED',
        at: o9At(30),
        actor: 'SELLER',
        cancel: {
          reason: 'BUYER_REQUEST',
          fault: 'BUYER',
          refundAmount: o9Refund,
        },
      },
    ],
    // 구매자 사정 부분 환불은 남은 금액을 취소 시각에 정산 확정
    settlement: { baseAmount: p2.regular_price - o9Refund, at: o9At(30) },
  });

  const o10At = (h: number) => new Date(now.getTime() - 2 * day + h * hour);
  const o10 = await createFlowOrder(prisma, {
    ...storeAContext,
    orderNumber: 'SEED-O10-UNPAID',
    product: p1,
    pickupAt: new Date(now.getTime() + 1 * day),
    steps: [
      { to: 'PENDING_PAYMENT', at: o10At(0), actor: 'BUYER' },
      {
        to: 'CANCELED',
        at: o10At(1),
        actor: 'SYSTEM',
        cancel: { reason: 'PAYMENT_NOT_RECEIVED', refundAmount: 0 },
      },
    ],
  });

  const o11At = (h: number) => new Date(now.getTime() - 2 * hour + h * hour);
  const o11PickupAt = new Date(now.getTime() + 3 * day);
  const o11 = await createFlowOrder(prisma, {
    ...storeAContext,
    orderNumber: 'SEED-O11-PAID',
    product: p1,
    pickupAt: o11PickupAt,
    steps: [
      { to: 'PENDING_PAYMENT', at: o11At(0), actor: 'BUYER' },
      { to: 'SUBMITTED', at: o11At(0.5), actor: 'ADMIN' },
    ],
    confirmDeadlineAt: new Date(
      Math.min(o11At(0.5).getTime() + day, o11PickupAt.getTime()),
    ),
  });

  return {
    o1Submitted: o1.id,
    o2Confirmed: o2.id,
    o3Made: o3.id,
    o4PickedUpReviewed: o4.id,
    o4OrderItemId: o4Item.id,
    o5PickedUpReviewable: o5.id,
    o6Canceled: o6.id,
    o7PendingPayment: o7.id,
    o8NoShow: o8.id,
    o9PartialRefund: o9.id,
    o10UnpaidCanceled: o10.id,
    o11PaidSubmitted: o11.id,
  };
}

const TIMESTAMP_BY_STATUS: Partial<
  Record<
    OrderStatus,
    'submitted_at' | 'confirmed_at' | 'made_at' | 'canceled_at' | 'no_show_at'
  >
> = {
  SUBMITTED: 'submitted_at',
  CONFIRMED: 'confirmed_at',
  MADE: 'made_at',
  CANCELED: 'canceled_at',
  NO_SHOW: 'no_show_at',
};

/** 단일 품목(정가, 수량 1) 주문을 전이 단계대로 만든다. 마지막 단계가 현재 상태다. */
async function createFlowOrder(
  prisma: PrismaClient,
  args: {
    accountId: bigint;
    buyerName: string;
    buyerPhone: string;
    storeId: bigint;
    storeName: string;
    regionLabel: string | null;
    orderNumber: string;
    product: Product;
    pickupAt: Date;
    steps: FlowStep[];
    settlement?: { baseAmount: number; at: Date };
    confirmDeadlineAt?: Date;
  },
) {
  const price = args.product.regular_price;
  const timestamps = Object.fromEntries(
    args.steps.flatMap((step) => {
      const column = TIMESTAMP_BY_STATUS[step.to];
      return column ? [[column, step.at]] : [];
    }),
  );
  return prisma.order.create({
    data: {
      order_number: args.orderNumber,
      account_id: args.accountId,
      status: args.steps[args.steps.length - 1].to,
      pickup_at: args.pickupAt,
      buyer_name: args.buyerName,
      buyer_phone: args.buyerPhone,
      subtotal_price: price,
      discount_price: 0,
      total_price: price,
      created_at: args.steps[0].at,
      ...timestamps,
      confirm_deadline_at: args.confirmDeadlineAt ?? null,
      ...(args.settlement
        ? {
            settlement_base_amount: args.settlement.baseAmount,
            commission_amount: 0,
            settlement_finalized_at: args.settlement.at,
          }
        : {}),
      items: {
        create: [
          {
            store_id: args.storeId,
            product_id: args.product.id,
            product_name_snapshot: args.product.name,
            store_name_snapshot: args.storeName,
            store_region_label_snapshot: args.regionLabel,
            product_thumbnail_url_snapshot: await firstImageUrl(
              prisma,
              args.product.id,
            ),
            regular_price_snapshot: price,
            sale_price_snapshot: null,
            quantity: 1,
            item_subtotal_price: price,
          },
        ],
      },
      status_histories: {
        create: args.steps.map((step, i) => ({
          from_status: i === 0 ? null : args.steps[i - 1].to,
          to_status: step.to,
          changed_at: step.at,
          actor_type: step.actor,
          ...(step.cancel
            ? {
                cancel_reason: step.cancel.reason,
                cancel_fault: step.cancel.fault ?? null,
                refund_amount: step.cancel.refundAmount,
              }
            : {}),
        })),
      },
    },
  });
}
