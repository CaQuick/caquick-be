import { DAY_MS } from '@/common/utils/kst-time';
import { buildRegionLabel } from '@/common/utils/region-label';
import type {
  CustomImageKind,
  CustomMode,
  Order,
  OrderCustomUpload,
  OrderItem,
  OrderStatus,
  Payment,
  PaymentSetting,
  PaymentStatus,
  Prisma,
  PrismaClient,
} from '@/generated/prisma/client';
import { activeWhere } from '@/prisma';
import { createAccount } from '@/test/factories/account.factory';
import { createProduct } from '@/test/factories/product.factory';
import { nextSeq } from '@/test/factories/sequence';

export interface OrderOverrides {
  account_id?: bigint;
  order_number?: string;
  status?: OrderStatus;
  pickup_at?: Date;
  buyer_name?: string;
  buyer_phone?: string;
  subtotal_price?: number;
  discount_price?: number;
  total_price?: number;
  deleted_at?: Date;
  idempotency_key?: string;
  created_at?: Date;
  commission_rate_bps?: number;
  /** 미지정 시 PENDING_PAYMENT면 null, 그 밖의 상태는 생성 시각(입금 확인 = 판매자 노출) */
  submitted_at?: Date | null;
}

export async function createOrder(
  prisma: PrismaClient,
  overrides: OrderOverrides = {},
): Promise<Order> {
  const seq = nextSeq();
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;
  const status = overrides.status ?? 'SUBMITTED';

  return prisma.order.create({
    data: {
      account_id: accountId,
      order_number: overrides.order_number ?? `ORD-${Date.now()}-${seq}`,
      status,
      pickup_at: overrides.pickup_at ?? new Date(Date.now() + DAY_MS),
      buyer_name: overrides.buyer_name ?? `Buyer ${seq}`,
      buyer_phone: overrides.buyer_phone ?? '010-0000-0000',
      subtotal_price: overrides.subtotal_price ?? 10000,
      discount_price: overrides.discount_price ?? 0,
      total_price: overrides.total_price ?? 10000,
      ...(overrides.idempotency_key
        ? { idempotency_key: overrides.idempotency_key }
        : {}),
      ...(overrides.deleted_at ? { deleted_at: overrides.deleted_at } : {}),
      ...(overrides.created_at ? { created_at: overrides.created_at } : {}),
      ...(overrides.commission_rate_bps !== undefined
        ? { commission_rate_bps: overrides.commission_rate_bps }
        : {}),
      submitted_at:
        overrides.submitted_at !== undefined
          ? overrides.submitted_at
          : status === 'PENDING_PAYMENT'
            ? null
            : (overrides.created_at ?? new Date()),
    },
  });
}

export type PaymentSettingOverrides = Partial<
  Pick<
    PaymentSetting,
    | 'commission_rate_bps'
    | 'deposit_bank_code'
    | 'deposit_account_number'
    | 'deposit_account_holder'
  >
>;

/** 결제 설정 단일 행(id=1). truncateAll이 마이그레이션이 넣은 행까지 지우므로 필요한 spec이 다시 만든다. */
export async function createPaymentSetting(
  prisma: PrismaClient,
  overrides: PaymentSettingOverrides = {},
): Promise<PaymentSetting> {
  const data = {
    commission_rate_bps: 0,
    deposit_bank_code: '004',
    deposit_account_number: '12345678901234',
    deposit_account_holder: '케이퀵',
    ...overrides,
  };
  return prisma.paymentSetting.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
}

export interface PaymentOverrides {
  /** 미지정 시 입금 대기 주문을 새로 만든다 */
  order_id?: bigint;
  status?: PaymentStatus;
  /** 미지정 시 주문 total_price */
  amount?: number;
  depositor_name?: string;
  expires_at?: Date;
  buyer_claimed_at?: Date | null;
  confirmed_at?: Date | null;
}

/** 계좌이체 결제. 계좌 스냅샷은 createPaymentSetting 기본값과 같다. */
export async function createPayment(
  prisma: PrismaClient,
  overrides: PaymentOverrides = {},
): Promise<Payment> {
  const order = overrides.order_id
    ? await prisma.order.findUniqueOrThrow({
        where: { id: overrides.order_id },
      })
    : await createOrder(prisma, { status: 'PENDING_PAYMENT' });
  return prisma.payment.create({
    data: {
      order_id: order.id,
      method: 'BANK_TRANSFER',
      status: overrides.status ?? 'PENDING',
      amount: overrides.amount ?? order.total_price,
      depositor_name: overrides.depositor_name ?? order.buyer_name.slice(0, 20),
      deposit_bank_code: '004',
      deposit_account_number: '12345678901234',
      deposit_account_holder: '케이퀵',
      expires_at:
        overrides.expires_at ??
        new Date(order.created_at.getTime() + 3_600_000),
      buyer_claimed_at: overrides.buyer_claimed_at ?? null,
      confirmed_at: overrides.confirmed_at ?? null,
    },
  });
}

export interface OrderItemOverrides {
  order_id?: bigint;
  store_id?: bigint;
  product_id?: bigint;
  product_name_snapshot?: string;
  /** 미지정 시 주문 생성 경로와 같은 규칙(현재 매장명·지역 표기·활성 첫 이미지)으로 채운다. */
  store_name_snapshot?: string;
  store_region_label_snapshot?: string | null;
  product_thumbnail_url_snapshot?: string | null;
  regular_price_snapshot?: number;
  sale_price_snapshot?: number | null;
  quantity?: number;
  item_subtotal_price?: number;
  custom_mode_snapshot?: CustomMode;
  custom_base_image_url_snapshot?: string | null;
  custom_preview_image_url?: string | null;
  deleted_at?: Date;
}

export async function createOrderItem(
  prisma: PrismaClient,
  overrides: OrderItemOverrides = {},
): Promise<OrderItem> {
  // product_id와 store_id는 항상 같은 상품 기준으로 일관성을 유지한다
  let productId = overrides.product_id;
  let storeId = overrides.store_id;
  if (productId && !storeId) {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    storeId = product.store_id;
  } else if (!productId) {
    const product = await createProduct(prisma, {
      ...(storeId ? { store_id: storeId } : {}),
    });
    productId = product.id;
    storeId = storeId ?? product.store_id;
  }

  const orderId = overrides.order_id ?? (await createOrder(prisma)).id;
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId! },
    include: { region: { select: { name: true } } },
  });
  const regionLabel =
    overrides.store_region_label_snapshot === undefined
      ? buildRegionLabel(store)
      : overrides.store_region_label_snapshot;
  const thumbnail =
    overrides.product_thumbnail_url_snapshot === undefined
      ? ((
          await prisma.productImage.findFirst({
            where: { product_id: productId, ...activeWhere },
            orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
          })
        )?.image_url ?? null)
      : overrides.product_thumbnail_url_snapshot;

  return prisma.orderItem.create({
    data: {
      order_id: orderId,
      store_id: storeId!,
      product_id: productId,
      product_name_snapshot:
        overrides.product_name_snapshot ?? 'Product snapshot',
      store_name_snapshot: overrides.store_name_snapshot ?? store.store_name,
      store_region_label_snapshot: regionLabel,
      product_thumbnail_url_snapshot: thumbnail,
      regular_price_snapshot: overrides.regular_price_snapshot ?? 10000,
      sale_price_snapshot: overrides.sale_price_snapshot ?? null,
      quantity: overrides.quantity ?? 1,
      item_subtotal_price: overrides.item_subtotal_price ?? 10000,
      custom_mode_snapshot: overrides.custom_mode_snapshot ?? 'NONE',
      custom_base_image_url_snapshot:
        overrides.custom_base_image_url_snapshot ?? null,
      custom_preview_image_url: overrides.custom_preview_image_url ?? null,
      ...(overrides.deleted_at ? { deleted_at: overrides.deleted_at } : {}),
    },
  });
}

const THREE_D_RENDER_KINDS = [
  'THREE_D_TOP',
  'THREE_D_FRONT',
  'THREE_D_BACK',
  'THREE_D_LEFT',
  'THREE_D_RIGHT',
] as const satisfies readonly CustomImageKind[];

export const MINIMAL_THREE_D_DESIGN = {
  schemaVersion: 1,
  basic: {
    shape: 'heart',
    size: 'mini',
    design: null,
    flavor: null,
    sheetColor: 'white',
  },
  top: [],
  side: [],
};

/** 3D 품목 스냅샷: 디자인 JSON과 렌더 5장(`https://img/<kind>.png`). 정렬이 드러나게 종류 역순으로 넣는다. */
export async function createThreeDOrderItemCustom(
  prisma: PrismaClient,
  orderItemId: bigint,
  designJson: Prisma.InputJsonValue = MINIMAL_THREE_D_DESIGN,
): Promise<void> {
  await prisma.orderItemCustomDesign.create({
    data: {
      order_item_id: orderItemId,
      schema_version: 1,
      design_json: designJson,
    },
  });
  for (const kind of [...THREE_D_RENDER_KINDS].reverse()) {
    await prisma.orderItemCustomImage.create({
      data: {
        order_item_id: orderItemId,
        kind,
        image_url: `https://img/${kind}.png`,
      },
    });
  }
}

export type OrderCustomUploadOverrides = Partial<
  Pick<
    OrderCustomUpload,
    | 'account_id'
    | 'purpose'
    | 'object_key'
    | 'status'
    | 'created_at'
    | 'purge_started_at'
    | 'attached_at'
  >
>;

/** 커스텀 이미지 선업로드 기록. 계정을 안 주면 구매자를 새로 만든다. */
export async function createOrderCustomUpload(
  prisma: PrismaClient,
  overrides: OrderCustomUploadOverrides = {},
): Promise<OrderCustomUpload> {
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;
  return prisma.orderCustomUpload.create({
    data: {
      purpose: 'RENDER',
      object_key: `order-custom/renders/${accountId}/2026-11-19/${nextSeq()}.png`,
      content_type: 'image/png',
      content_length: 1024,
      ...overrides,
      account_id: accountId,
    },
  });
}
