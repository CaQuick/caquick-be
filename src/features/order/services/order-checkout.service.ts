import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import { RandomService } from '@/common/providers/random.service';
import { parseId } from '@/common/utils/id-parser';
import { formatKstDate, kstDayBoundaries } from '@/common/utils/kst-time';
import { uniqueConstraintName } from '@/common/utils/prisma-error';
import { buildRegionLabel } from '@/common/utils/region-label';
import { codePointLength } from '@/common/utils/text-cleaner';
import { evaluateActiveUserAccount } from '@/features/auth';
import type { CreateOrderInput } from '@/features/order/dto/inputs/create-order.input';
import { OrderCustomUploadRepository } from '@/features/order/repositories/order-custom-upload.repository';
import {
  OrderRepository,
  type CreatedOrderRow,
  type CreatePendingPaymentOrderArgs,
} from '@/features/order/repositories/order.repository';
import { PaymentSettingRepository } from '@/features/order/repositories/payment-setting.repository';
import { hashCreateOrderInput } from '@/features/order/services/order-input-hash.helper';
import { toOrderPaymentOutput } from '@/features/order/services/order-payment-mappers.helper';
import type { CreateOrderOutput } from '@/features/order/types/create-order-output.type';
import { ProductRepository, type ProductDetailRow } from '@/features/product';
import { StorePickupScheduleService } from '@/features/store';
import {
  Prisma,
  type OrderCustomUploadPurpose,
} from '@/generated/prisma/client';
import { S3Service } from '@/global/storage/s3.service';
import type {
  CreateUploadUrlOutput,
  UploadPurpose,
} from '@/global/storage/types/storage.types';

// 0/O·1/I 등 혼동 문자를 뺀 대문자 영숫자. 주문번호 무작위부에 사용.
const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ORDER_NUMBER_RANDOM_LENGTH = 6;
// unique 충돌은 확률적으로 희박 — 소수 재시도로 충분하다
const ORDER_NUMBER_MAX_ATTEMPTS = 3;

// GraphQL Int는 signed 32비트. 커밋 전에 금액을 이 범위로 제한해
// "저장은 됐는데 응답 직렬화에서 실패 → 재시도 중복 주문" 경로를 차단한다.
const MAX_ORDER_AMOUNT = 2_147_483_647;

/** 미입금 자동 취소까지의 입금 기한. */
const PAYMENT_WINDOW_MS = 60 * 60_000;
/** 은행 입금자명과 대조하는 값이라 자르지 않고 입력을 요구한다. */
const MAX_DEPOSITOR_NAME_LENGTH = 20;

const CUSTOM_UPLOAD_PURPOSES = {
  RENDER: 'ORDER_CUSTOM_RENDER',
  COMPOSITE: 'ORDER_CUSTOM_COMPOSITE',
  REFERENCE: 'ORDER_CUSTOM_REFERENCE',
} as const satisfies Record<OrderCustomUploadPurpose, UploadPurpose>;

interface ResolvedOptionSelection {
  optionGroupId: bigint;
  optionItemId: bigint;
  groupNameSnapshot: string;
  optionTitleSnapshot: string;
  optionPriceDeltaSnapshot: number;
}

@Injectable()
export class OrderCheckoutService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductRepository,
    private readonly pickupSchedule: StorePickupScheduleService,
    private readonly clock: ClockService,
    private readonly random: RandomService,
    private readonly paymentSettings: PaymentSettingRepository,
    private readonly customUploads: OrderCustomUploadRepository,
    private readonly s3: S3Service,
  ) {}

  /**
   * 커스텀 이미지(3D 렌더·슬롯형 합성·참고 사진) 선업로드 URL. 발급을 기록해 두고, 주문에 쓰이지 않으면
   * 정리 크론이 하루 뒤 지운다. 형식·크기는 S3 정책이 검증한다.
   */
  async createOrderCustomUploadUrl(
    accountId: bigint,
    input: {
      purpose: OrderCustomUploadPurpose;
      contentType: string;
      contentLength: number;
    },
  ): Promise<CreateUploadUrlOutput> {
    await this.requireActiveBuyer(accountId);
    const issued = await this.s3.createUploadUrl({
      accountId,
      purpose: CUSTOM_UPLOAD_PURPOSES[input.purpose],
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
    await this.customUploads.create({
      accountId,
      purpose: input.purpose,
      objectKey: issued.key,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
    return issued;
  }

  /**
   * 옵션 그룹 규칙·픽업 일시를 서버가 재검증하고 가격을 스냅샷한 뒤 입금 대기 주문을 만든다.
   * 판매자에게는 입금 확인 뒤에 보이므로 여기서는 판매자 구독을 발행하지 않는다.
   */
  async createOrder(
    accountId: bigint,
    input: CreateOrderInput,
  ): Promise<CreateOrderOutput> {
    const productId = parseId(input.productId);
    const optionItemIds = input.optionItemIds.map((id) => parseId(id));
    const quantity = input.quantity ?? 1;
    const inputHash = hashCreateOrderInput({
      ...input,
      productId,
      optionItemIds,
    });

    // 멱등 replay: 같은 (계정, 키)의 주문이 있으면 검증·생성 없이 그 결과를 반환한다 — 원 요청 시점의 검증을 이미 통과한 주문이다.
    const replayed = await this.orderRepo.findOrderByIdempotencyKey(
      accountId,
      input.idempotencyKey,
    );
    if (replayed) {
      assertReplayInputMatches(replayed, inputHash);
      return this.toCreateOrderOutput(replayed);
    }

    const buyerProfile = await this.requireActiveBuyer(accountId);

    const product = await this.productRepo.findProductDetailById(productId);
    if (!product) {
      throw new DomainException('PRODUCT_NOT_FOUND');
    }
    // Order/OrderItem에 통화 스냅샷 컬럼이 없어 비 KRW 금액은 통화 정보가 소실된다 — 다국통화 스냅샷 설계 전까지 KRW만 허용
    if (product.currency !== 'KRW') {
      throw new DomainException('UNSUPPORTED_CURRENCY');
    }

    const selections = this.resolveOptionSelections(product, optionItemIds);
    const buyer = this.resolveBuyerInfo(buyerProfile, input);
    const depositorName = resolveDepositorName(input.depositorName, buyer.name);

    const now = this.clock.now();
    // 영업일·슬롯·하한(리드타임과 제작 시간 중 긴 쪽)은 달력과 같은 catalog 판정, 주문 수량까지 더한 capacity 잔여는 order 복제본이 판정한다
    const capacityGuard = this.buildCapacityGuard(
      product.store_id,
      input.pickupAt,
    );
    const pickupAvailable =
      (await this.pickupSchedule.isPickupSlotAvailable({
        storeId: product.store_id,
        pickupAt: input.pickupAt,
        preparationTimeMinutes: product.preparation_time_minutes,
      })) &&
      !(await this.orderRepo.isDailyCapacityExceeded(capacityGuard, quantity));
    if (!pickupAvailable) {
      // 같은 키의 동시 재시도가 방금 capacity를 채운 것일 수 있다 — 거절 전에 키를 재조회해,
      // 내 주문이 이미 생성돼 있으면 실패 대신 replay로 응답한다(응답 유실 재시도가 '가득 참' 실패를 받는 race 차단).
      const raced = await this.replayOrReject(
        accountId,
        input.idempotencyKey,
        inputHash,
        'PICKUP_NOT_AVAILABLE',
      );
      return this.toCreateOrderOutput(raced);
    }

    // 가격 스냅샷: FE 제출 금액은 신뢰하지 않고 서버가 재계산한다.
    // subtotal은 정가 기준, discount는 정가-판매가 차액 → total = 판매가 기준.
    const deltaSum = selections.reduce(
      (sum, selection) => sum + selection.optionPriceDeltaSnapshot,
      0,
    );
    const effectivePrice = product.sale_price ?? product.regular_price;
    const subtotalPrice = (product.regular_price + deltaSum) * quantity;
    const discountPrice = (product.regular_price - effectivePrice) * quantity;
    const itemSubtotalPrice = (effectivePrice + deltaSum) * quantity;
    // 음수(과도한 음수 델타·판매가>정가 이상 데이터)나 32비트 초과 금액은
    // unsigned 컬럼/GraphQL Int에서 깨진다 — 커밋 전에 거절한다
    for (const amount of [subtotalPrice, discountPrice, itemSubtotalPrice]) {
      if (
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        amount > MAX_ORDER_AMOUNT
      ) {
        throw new DomainException('ORDER_AMOUNT_OUT_OF_RANGE');
      }
    }
    // 구매자가 본 금액과 다르면 바뀐 가격으로 주문을 만들지 않는다
    if (itemSubtotalPrice !== input.expectedTotalPrice) {
      throw new DomainException('ORDER_PRICE_CHANGED');
    }

    const setting = await this.paymentSettings.findPaymentSetting();
    const {
      deposit_bank_code: depositBankCode,
      deposit_account_number: depositAccountNumber,
      deposit_account_holder: depositAccountHolder,
    } = setting;
    // 결제 설정은 보낸 필드만 바꾸므로 일부만 채워진 행이 있을 수 있다 — 세 값이 다 있어야 안내할 수 있다
    if (!depositBankCode || !depositAccountNumber || !depositAccountHolder) {
      throw new DomainException('PAYMENT_ACCOUNT_NOT_CONFIGURED');
    }

    const created = await this.createWithOrderNumberRetry({
      accountId,
      idempotencyKey: input.idempotencyKey,
      idempotencyInputHash: inputHash,
      pickupAt: input.pickupAt,
      buyerName: buyer.name,
      buyerPhone: buyer.phone,
      requestNote: input.requestNote?.trim() || null,
      subtotalPrice,
      discountPrice,
      totalPrice: itemSubtotalPrice,
      commissionRateBps: setting.commission_rate_bps,
      now,
      capacityGuard,
      payment: {
        depositorName,
        depositBankCode,
        depositAccountNumber,
        depositAccountHolder,
        expiresAt: new Date(now.getTime() + PAYMENT_WINDOW_MS),
      },
      item: {
        storeId: product.store_id,
        productId: product.id,
        productNameSnapshot: product.name,
        // 주문 시점 표시값 — 이후 매장명·이미지가 바뀌어도 주문 화면은 이 값을 유지한다
        storeNameSnapshot: product.store.store_name,
        storeRegionLabelSnapshot: buildRegionLabel(product.store),
        productThumbnailUrlSnapshot: product.images[0]?.image_url ?? null,
        regularPriceSnapshot: product.regular_price,
        salePriceSnapshot: product.sale_price,
        quantity,
        itemSubtotalPrice,
        options: selections,
      },
    });

    return this.toCreateOrderOutput(created);
  }

  private toCreateOrderOutput(row: CreatedOrderRow): CreateOrderOutput {
    return {
      orderId: row.id.toString(),
      orderNumber: row.order_number,
      status: row.status,
      pickupAt: row.pickup_at,
      totalPrice: row.total_price,
      payment: row.payment ? toOrderPaymentOutput(row.payment) : null,
    };
  }

  private buildCapacityGuard(storeId: bigint, pickupAt: Date) {
    const { dateOnlyUtc, dayStartUtc, dayEndUtc } = kstDayBoundaries(pickupAt);
    return { storeId, dateOnlyUtc, dayStartUtc, dayEndUtc };
  }

  /** 필수 그룹은 min~max개 선택, 선택 그룹은 0개 또는 min~max개. */
  private resolveOptionSelections(
    product: ProductDetailRow,
    optionItemIds: bigint[],
  ): ResolvedOptionSelection[] {
    const uniqueIds = new Set(optionItemIds.map((id) => id.toString()));
    if (uniqueIds.size !== optionItemIds.length) {
      throw new DomainException('DUPLICATE_OPTION_ITEM');
    }

    const selectionByItemId = new Map<string, ResolvedOptionSelection>();
    const groupIdByItemId = new Map<string, string>();
    for (const group of product.option_groups) {
      for (const item of group.option_items) {
        selectionByItemId.set(item.id.toString(), {
          optionGroupId: group.id,
          optionItemId: item.id,
          groupNameSnapshot: group.name,
          optionTitleSnapshot: item.title,
          optionPriceDeltaSnapshot: item.price_delta,
        });
        groupIdByItemId.set(item.id.toString(), group.id.toString());
      }
    }

    const countByGroupId = new Map<string, number>();
    const selections = optionItemIds.map((id) => {
      const selection = selectionByItemId.get(id.toString());
      if (!selection) {
        throw new DomainException('INVALID_OPTION_ITEM');
      }
      const groupId = groupIdByItemId.get(id.toString());
      if (groupId !== undefined) {
        countByGroupId.set(groupId, (countByGroupId.get(groupId) ?? 0) + 1);
      }
      return selection;
    });

    for (const group of product.option_groups) {
      const count = countByGroupId.get(group.id.toString()) ?? 0;
      const withinRange =
        count >= group.min_select && count <= group.max_select;
      const valid = group.is_required
        ? withinRange
        : count === 0 || withinRange;
      if (!valid) {
        throw new DomainException('OPTION_GROUP_RULE_VIOLATION');
      }
    }
    return selections;
  }

  /** 판정 분기는 user feature의 공용 정책(evaluateActiveUserAccount)을 소비하고 실패 사유 → 주문 도메인 코드 매핑만 여기서 한다. SELLER/ADMIN이 구매자 mutation으로 주문을 만드는 것을 차단한다. */
  private async requireActiveBuyer(
    accountId: bigint,
  ): Promise<{ nickname: string; phone_number: string | null }> {
    const account =
      await this.orderRepo.findAccountWithProfileForCheckout(accountId);
    const failure = evaluateActiveUserAccount(account);
    if (failure === 'NOT_USER') {
      throw new DomainException('USER_ONLY');
    }
    if (failure !== null || !account?.user_profile) {
      throw new DomainException('BUYER_ACCOUNT_NOT_ACTIVE');
    }
    return account.user_profile;
  }

  private resolveBuyerInfo(
    profile: { nickname: string; phone_number: string | null },
    input: CreateOrderInput,
  ): { name: string; phone: string } {
    // 이름은 프로필 닉네임(NOT NULL)이 최종 fallback이라 항상 존재한다.
    // 공백만 입력된 이름은 빈 표기로 커밋되지 않게 미입력으로 취급한다.
    const trimmedName = input.buyerName?.trim();
    const name = trimmedName || profile.nickname;
    const phone = input.buyerPhone ?? profile.phone_number ?? undefined;
    if (!phone) {
      throw new DomainException('BUYER_PHONE_REQUIRED');
    }
    return { name, phone };
  }

  private async createWithOrderNumberRetry(
    args: Omit<CreatePendingPaymentOrderArgs, 'orderNumber'>,
  ): Promise<CreatedOrderRow> {
    for (let attempt = 0; attempt < ORDER_NUMBER_MAX_ATTEMPTS; attempt += 1) {
      try {
        const created = await this.orderRepo.createPendingPaymentOrder({
          ...args,
          orderNumber: this.generateOrderNumber(args.now),
        });
        if (created === 'lock-timeout') {
          throw new DomainException('CONCURRENT_REQUEST');
        }
        if (created === 'capacity-exceeded' || created === 'pending-limit') {
          // 트랜잭션 안 잠금 재검사에서 거절됐다. 자리를 채운 것이 같은 키의 내 주문(응답 유실 재시도)일 수 있어
          // 거절 전에 replay를 확인한다.
          return this.replayOrReject(
            args.accountId,
            args.idempotencyKey,
            args.idempotencyInputHash,
            created === 'capacity-exceeded'
              ? 'PICKUP_NOT_AVAILABLE'
              : 'PENDING_PAYMENT_LIMIT_EXCEEDED',
          );
        }
        return created;
      } catch (error) {
        const isUniqueViolation =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        // 멱등 키 unique 충돌 = 같은 키의 동시 중복 제출. 사전 조회를 둘 다 통과한 race라, 먼저 생성된 주문을 조회해 replay로 반환한다.
        if (isUniqueViolation && this.isIdempotencyConflict(error)) {
          const existing = await this.orderRepo.findOrderByIdempotencyKey(
            args.accountId,
            args.idempotencyKey,
          );
          if (existing) {
            assertReplayInputMatches(existing, args.idempotencyInputHash);
            return existing;
          }
          // 활성 주문이 없는데 키 unique가 충돌했다면 soft-delete된 주문이 키를 점유한 경우다 — MySQL unique는
          // deleted_at을 보지 않는다. 같은 키로는 몇 번을 재시도해도 동일하게 실패하므로 새 주문서(새 키)로 유도한다.
          const heldByDeleted =
            await this.orderRepo.existsDeletedOrderWithIdempotencyKey(
              args.accountId,
              args.idempotencyKey,
            );
          if (heldByDeleted) {
            // 409가 아니라 400 — 클라이언트가 일시 장애로 오인해 같은 키로 재시도하지 않게, "입력을 고쳐 다시 보내라"는 의미로 분류한다.
            throw new DomainException('IDEMPOTENCY_KEY_UNAVAILABLE');
          }
          // 그 외(조회 직후 하드 삭제 등 극단적 race)는 재시도가 유효할 수 있다
          throw new DomainException('IDEMPOTENT_REPLAY_FAILED');
        }
        if (!isUniqueViolation || attempt === ORDER_NUMBER_MAX_ATTEMPTS - 1) {
          if (isUniqueViolation) {
            throw new DomainException('ORDER_NUMBER_GENERATION_FAILED');
          }
          throw error;
        }
      }
    }
    // 루프는 반환/throw로만 종료된다 — 타입 좁히기용 방어
    throw new DomainException('ORDER_NUMBER_GENERATION_FAILED');
  }

  private async replayOrReject(
    accountId: bigint,
    idempotencyKey: string,
    inputHash: string,
    rejectCode: 'PICKUP_NOT_AVAILABLE' | 'PENDING_PAYMENT_LIMIT_EXCEEDED',
  ): Promise<CreatedOrderRow> {
    const existing = await this.orderRepo.findOrderByIdempotencyKey(
      accountId,
      idempotencyKey,
    );
    if (!existing) throw new DomainException(rejectCode);
    assertReplayInputMatches(existing, inputHash);
    return existing;
  }

  /** 그 외 P2002(주문번호 등)는 재시도 대상이라 구분한다. */
  private isIdempotencyConflict(
    error: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    return uniqueConstraintName(error)?.includes('idempotency') ?? false;
  }

  private generateOrderNumber(at: Date): string {
    const datePart = formatKstDate(at).replaceAll('-', '');
    let randomPart = '';
    for (let i = 0; i < ORDER_NUMBER_RANDOM_LENGTH; i += 1) {
      randomPart += ORDER_NUMBER_ALPHABET.charAt(
        this.random.int(ORDER_NUMBER_ALPHABET.length),
      );
    }
    return `ORD-${datePart}-${randomPart}`;
  }
}

/** 생략·공백이면 주문자 이름. 어느 쪽이든 20자를 넘으면 자르지 않고 입력을 요구한다. */
function resolveDepositorName(
  raw: string | null | undefined,
  buyerName: string,
): string {
  const name = raw?.trim() || buyerName;
  if (codePointLength(name) > MAX_DEPOSITOR_NAME_LENGTH) {
    throw new DomainException('DEPOSITOR_NAME_INVALID');
  }
  return name;
}

/** 해시 도입 전 주문(null)은 비교하지 않는다. */
function assertReplayInputMatches(
  existing: { idempotency_input_hash: string | null },
  inputHash: string,
): void {
  if (
    existing.idempotency_input_hash !== null &&
    existing.idempotency_input_hash !== inputHash
  ) {
    throw new DomainException('IDEMPOTENCY_KEY_INPUT_MISMATCH');
  }
}
