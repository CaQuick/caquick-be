/**
 * 시드 주문 + 아이템 + 상태 히스토리.
 *
 * user1 기준 6건:
 *   o1 SUBMITTED  - p1×1
 *   o2 CONFIRMED  - p2×1 + selectedOptions(레귤러)
 *   o3 MADE       - p3×2
 *   o4 PICKED_UP  - p1×1 (리뷰 작성됨 → hasReviewableItem=false, hasMyReview=true)
 *   o5 PICKED_UP  - p4×1 (리뷰 미작성 → hasReviewableItem=true)
 *   o6 CANCELED   - p2×1
 */
import type { OrderStatus, PrismaClient } from '@prisma/client';

import type { SeededStores } from './stores';
import type { SeededUser } from './users';

export interface SeededOrders {
  o1Submitted: bigint;
  o2Confirmed: bigint;
  o3Made: bigint;
  o4PickedUpReviewed: bigint;
  o4OrderItemId: bigint;
  o5PickedUpReviewable: bigint;
  o6Canceled: bigint;
}

export async function seedOrders(
  prisma: PrismaClient,
  ctx: { users: SeededUser[]; stores: SeededStores },
): Promise<SeededOrders> {
  const user1 = ctx.users[0];
  if (!user1) throw new Error('seedUsers must run before seedOrders');
  const [storeA, storeB] = ctx.stores.stores;
  const [p1, p2, p3, p4] = ctx.stores.products;
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
      subtotal_price: 35000,
      discount_price: 0,
      total_price: 35000,
      submitted_at: now,
      items: {
        create: [
          {
            store_id: storeA.id,
            product_id: p1.id,
            product_name_snapshot: p1.name,
            regular_price_snapshot: p1.regular_price,
            sale_price_snapshot: p1.sale_price,
            quantity: 1,
            item_subtotal_price: 35000,
          },
        ],
      },
      status_histories: {
        create: [
          { from_status: null, to_status: 'SUBMITTED', changed_at: now },
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
          },
          {
            from_status: 'SUBMITTED',
            to_status: 'CONFIRMED',
            changed_at: o2ConfirmedAt,
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
            regular_price_snapshot: p3.regular_price,
            sale_price_snapshot: p3.sale_price,
            quantity: 2,
            item_subtotal_price: 44000,
          },
        ],
      },
      status_histories: {
        create: [
          { to_status: 'SUBMITTED', changed_at: o3Submitted },
          {
            from_status: 'SUBMITTED',
            to_status: 'CONFIRMED',
            changed_at: o3Confirmed,
          },
          {
            from_status: 'CONFIRMED',
            to_status: 'MADE',
            changed_at: o3Made,
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
      subtotal_price: 35000,
      discount_price: 0,
      total_price: 35000,
      submitted_at: o4Sub,
      confirmed_at: o4Conf,
      made_at: o4Made,
      picked_up_at: o4Picked,
      status_histories: {
        create: [
          { to_status: 'SUBMITTED', changed_at: o4Sub },
          {
            from_status: 'SUBMITTED',
            to_status: 'CONFIRMED',
            changed_at: o4Conf,
          },
          { from_status: 'CONFIRMED', to_status: 'MADE', changed_at: o4Made },
          { from_status: 'MADE', to_status: 'PICKED_UP', changed_at: o4Picked },
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
      regular_price_snapshot: p1.regular_price,
      sale_price_snapshot: p1.sale_price,
      quantity: 1,
      item_subtotal_price: 35000,
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
          },
          {
            from_status: 'SUBMITTED',
            to_status: 'CONFIRMED',
            changed_at: new Date(now.getTime() - 7 * day),
          },
          {
            from_status: 'CONFIRMED',
            to_status: 'MADE',
            changed_at: new Date(now.getTime() - 6 * day),
          },
          {
            from_status: 'MADE',
            to_status: 'PICKED_UP',
            changed_at: o5Picked,
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
            regular_price_snapshot: p2.regular_price,
            sale_price_snapshot: null,
            quantity: 1,
            item_subtotal_price: 50000,
          },
        ],
      },
      status_histories: {
        create: [
          { to_status: 'SUBMITTED', changed_at: o6Sub },
          {
            from_status: 'SUBMITTED',
            to_status: 'CANCELED',
            changed_at: o6Cancel,
            note: '재료 수급 불가',
          },
        ],
      },
    },
  });

  return {
    o1Submitted: o1.id,
    o2Confirmed: o2.id,
    o3Made: o3.id,
    o4PickedUpReviewed: o4.id,
    o4OrderItemId: o4Item.id,
    o5PickedUpReviewable: o5.id,
    o6Canceled: o6.id,
  };
}
