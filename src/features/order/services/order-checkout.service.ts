import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ClockService } from '@/common/providers/clock.service';
import { RandomService } from '@/common/providers/random.service';
import { parseId } from '@/common/utils/id-parser';
import {
  DAY_MS,
  formatKstDate,
  kstMidnightUtc,
  toKstYmd,
} from '@/common/utils/kst-time';
import { ORDER_CHECKOUT_ERRORS } from '@/features/order/constants/order-error-messages';
import type { CreateOrderInput } from '@/features/order/dto/inputs/create-order.input';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import type { CreateOrderOutput } from '@/features/order/types/create-order-output.type';
import { ProductRepository, type ProductDetailRow } from '@/features/product';
import { StorePickupScheduleService } from '@/features/store';
import { evaluateActiveUserAccount } from '@/features/user';

// 0/O·1/I 등 혼동 문자를 뺀 대문자 영숫자. 주문번호 무작위부에 사용.
const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ORDER_NUMBER_RANDOM_LENGTH = 6;
// unique 충돌은 확률적으로 희박 — 소수 재시도로 충분하다
const ORDER_NUMBER_MAX_ATTEMPTS = 3;

// GraphQL Int는 signed 32비트. 커밋 전에 금액을 이 범위로 제한해
// "저장은 됐는데 응답 직렬화에서 실패 → 재시도 중복 주문" 경로를 차단한다.
const MAX_ORDER_AMOUNT = 2_147_483_647;

/** 옵션 검증 결과(스냅샷 조립용). */
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
  ) {}

  /**
   * 주문 생성(정식 API의 확정 부분집합 — 커스텀 입력은 스펙 확정 후 확장).
   * 옵션 그룹 규칙·픽업 일시를 서버가 재검증하고 가격을 스냅샷한다.
   */
  async createOrder(
    accountId: bigint,
    input: CreateOrderInput,
  ): Promise<CreateOrderOutput> {
    const productId = parseId(input.productId);
    const optionItemIds = input.optionItemIds.map((id) => parseId(id));
    const quantity = input.quantity ?? 1;

    // 멱등 replay: 같은 (계정, 키)의 주문이 있으면 검증·생성 없이 그 결과를
    // 반환한다 — 원 요청 시점의 검증을 이미 통과한 주문이다(이슈 #212).
    const replayed = await this.orderRepo.findOrderByIdempotencyKey(
      accountId,
      input.idempotencyKey,
    );
    if (replayed) {
      return this.toCreateOrderOutput(replayed);
    }

    const buyerProfile = await this.requireActiveBuyer(accountId);

    const product = await this.productRepo.findProductDetailById(productId);
    if (!product) {
      throw new NotFoundException(ORDER_CHECKOUT_ERRORS.PRODUCT_NOT_FOUND);
    }
    // Order/OrderItem에 통화 스냅샷 컬럼이 없어 비 KRW 금액은 통화 정보가
    // 소실된다 — 다국통화 스냅샷 설계 전까지 KRW만 허용(명세 외 정책 결정)
    if (product.currency !== 'KRW') {
      throw new BadRequestException(ORDER_CHECKOUT_ERRORS.UNSUPPORTED_CURRENCY);
    }

    const selections = this.resolveOptionSelections(product, optionItemIds);
    const buyer = this.resolveBuyerInfo(buyerProfile, input);

    const now = this.clock.now();
    // 상품별 제작 소요시간은 매장 리드타임과 별개 조건 — 둘 다 충족해야 한다
    const preparationDeadlineMs =
      now.getTime() + product.preparation_time_minutes * 60_000;
    const pickupAvailable =
      input.pickupAt.getTime() >= preparationDeadlineMs &&
      (await this.pickupSchedule.isPickupSlotAvailable({
        storeId: product.store_id,
        pickupAt: input.pickupAt,
        additionalQuantity: quantity,
      }));
    if (!pickupAvailable) {
      // 같은 키의 동시 재시도가 방금 capacity를 채운 것일 수 있다 — 거절 전에
      // 키를 재조회해, 내 주문이 이미 생성돼 있으면 실패 대신 replay로 응답한다
      // (릴리즈 리뷰 반영: 응답 유실 재시도가 '가득 참' 실패를 받는 race 차단).
      const raced = await this.replayAfterCapacityReject(
        accountId,
        input.idempotencyKey,
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
        throw new BadRequestException(
          ORDER_CHECKOUT_ERRORS.ORDER_AMOUNT_OUT_OF_RANGE,
        );
      }
    }

    const submittedAt = now;
    const created = await this.createWithOrderNumberRetry({
      accountId,
      idempotencyKey: input.idempotencyKey,
      pickupAt: input.pickupAt,
      buyerName: buyer.name,
      buyerPhone: buyer.phone,
      subtotalPrice,
      discountPrice,
      totalPrice: itemSubtotalPrice,
      submittedAt,
      capacityGuard: this.buildCapacityGuard(product.store_id, input.pickupAt),
      item: {
        storeId: product.store_id,
        productId: product.id,
        productNameSnapshot: product.name,
        regularPriceSnapshot: product.regular_price,
        salePriceSnapshot: product.sale_price,
        quantity,
        itemSubtotalPrice,
        options: selections,
      },
    });

    return this.toCreateOrderOutput(created);
  }

  private toCreateOrderOutput(row: {
    id: bigint;
    order_number: string;
    status: CreateOrderOutput['status'];
    pickup_at: Date;
    total_price: number;
  }): CreateOrderOutput {
    return {
      orderId: row.id.toString(),
      orderNumber: row.order_number,
      status: row.status,
      pickupAt: row.pickup_at,
      totalPrice: row.total_price,
    };
  }

  /** capacity 원자 검사 조건(픽업 KST 달력일 기준). */
  private buildCapacityGuard(storeId: bigint, pickupAt: Date) {
    const { year, month, day } = toKstYmd(pickupAt);
    const dayStartUtc = kstMidnightUtc(year, month, day);
    return {
      storeId,
      dateOnlyUtc: new Date(Date.UTC(year, month - 1, day)),
      dayStartUtc,
      dayEndUtc: new Date(dayStartUtc.getTime() + DAY_MS),
    };
  }

  /**
   * 옵션 선택 검증. 중복·타 상품 옵션을 거절하고 그룹 규칙을 확인한다.
   * 명세 외 정책 결정: 필수 그룹은 min~max개 선택, 선택 그룹은 0개 또는 min~max개.
   */
  private resolveOptionSelections(
    product: ProductDetailRow,
    optionItemIds: bigint[],
  ): ResolvedOptionSelection[] {
    const uniqueIds = new Set(optionItemIds.map((id) => id.toString()));
    if (uniqueIds.size !== optionItemIds.length) {
      throw new BadRequestException(
        ORDER_CHECKOUT_ERRORS.DUPLICATE_OPTION_ITEM,
      );
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
        throw new BadRequestException(
          ORDER_CHECKOUT_ERRORS.INVALID_OPTION_ITEM,
        );
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
        throw new BadRequestException(
          ORDER_CHECKOUT_ERRORS.OPTION_GROUP_RULE_VIOLATION,
        );
      }
      // 설명/이미지 필수 옵션은 커스텀 입력 없이는 판매자 요구 정보가 빠진 채
      // 주문된다 — 커스텀 체크아웃 확장 전까지 해당 옵션 선택은 거절한다
      if (
        count > 0 &&
        (group.option_requires_description || group.option_requires_image)
      ) {
        throw new BadRequestException(
          ORDER_CHECKOUT_ERRORS.OPTION_CUSTOMIZATION_REQUIRED,
        );
      }
    }
    return selections;
  }

  /**
   * 활성 USER 계정 + 활성 프로필 강제. 판정 분기는 user feature의 공용 정책
   * (evaluateActiveUserAccount) 단일 소스를 소비하고, 실패 사유 → 주문 도메인
   * 에러 메시지 매핑만 여기서 한다.
   * SELLER/ADMIN이 구매자 mutation으로 주문을 만드는 것을 차단한다.
   */
  private async requireActiveBuyer(
    accountId: bigint,
  ): Promise<{ nickname: string; phone_number: string | null }> {
    const account =
      await this.orderRepo.findAccountWithProfileForCheckout(accountId);
    const failure = evaluateActiveUserAccount(account);
    if (failure === 'NOT_USER') {
      throw new ForbiddenException(ORDER_CHECKOUT_ERRORS.BUYER_NOT_USER);
    }
    if (failure !== null || !account?.user_profile) {
      throw new UnauthorizedException(
        ORDER_CHECKOUT_ERRORS.BUYER_ACCOUNT_NOT_ACTIVE,
      );
    }
    return account.user_profile;
  }

  /** 주문자 정보: input 우선, 없으면 프로필(닉네임·전화번호) fallback. */
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
      throw new BadRequestException(ORDER_CHECKOUT_ERRORS.BUYER_PHONE_REQUIRED);
    }
    return { name, phone };
  }

  /** 주문번호 unique 충돌(P2002) 시 새 번호로 소수 재시도. */
  private async createWithOrderNumberRetry(
    args: Omit<
      Parameters<OrderRepository['createSubmittedOrder']>[0],
      'orderNumber'
    >,
  ) {
    for (let attempt = 0; attempt < ORDER_NUMBER_MAX_ATTEMPTS; attempt += 1) {
      try {
        const created = await this.orderRepo.createSubmittedOrder({
          ...args,
          orderNumber: this.generateOrderNumber(args.submittedAt),
        });
        if (created === null) {
          // 트랜잭션 내 capacity 재검사에서 잔여 부족 판정(동시 주문 race 차단).
          // 잔여를 채운 것이 같은 키의 내 주문일 수 있어 거절 전에 replay를 확인한다.
          return this.replayAfterCapacityReject(
            args.accountId,
            args.idempotencyKey,
          );
        }
        return created;
      } catch (error) {
        const isUniqueViolation =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        // 멱등 키 unique 충돌 = 같은 키의 동시 중복 제출. 사전 조회를 둘 다
        // 통과한 race라, 먼저 생성된 주문을 조회해 replay로 반환한다(이슈 #212).
        if (isUniqueViolation && this.isIdempotencyConflict(error)) {
          const existing = await this.orderRepo.findOrderByIdempotencyKey(
            args.accountId,
            args.idempotencyKey,
          );
          if (existing) return existing;
          // 생성 직후 소실(soft-delete 등) — 재시도 유도가 안전하다
          throw new InternalServerErrorException(
            ORDER_CHECKOUT_ERRORS.IDEMPOTENT_REPLAY_FAILED,
          );
        }
        if (!isUniqueViolation || attempt === ORDER_NUMBER_MAX_ATTEMPTS - 1) {
          if (isUniqueViolation) {
            throw new InternalServerErrorException(
              ORDER_CHECKOUT_ERRORS.ORDER_NUMBER_GENERATION_FAILED,
            );
          }
          throw error;
        }
      }
    }
    // 루프는 반환/throw로만 종료된다 — 타입 좁히기용 방어
    throw new InternalServerErrorException(
      ORDER_CHECKOUT_ERRORS.ORDER_NUMBER_GENERATION_FAILED,
    );
  }

  /**
   * capacity 계열 거절 직전의 멱등 replay 확인. 같은 키의 주문이 있으면
   * 그 주문을 반환하고, 없으면(진짜 잔여 부족) 픽업 불가로 거절한다.
   */
  private async replayAfterCapacityReject(
    accountId: bigint,
    idempotencyKey: string,
  ) {
    const existing = await this.orderRepo.findOrderByIdempotencyKey(
      accountId,
      idempotencyKey,
    );
    if (existing) return existing;
    throw new BadRequestException(ORDER_CHECKOUT_ERRORS.PICKUP_NOT_AVAILABLE);
  }

  /**
   * P2002 충돌이 멱등 키 unique(uk_order_account_idempotency)에서 난 것인지 판별.
   * MySQL은 meta.target에 제약 이름을 담는다 — 그 외(주문번호 등)는 재시도 대상.
   */
  private isIdempotencyConflict(
    error: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = error.meta?.target;
    return typeof target === 'string' && target.includes('idempotency');
  }

  /** 주문번호: ORD-YYYYMMDD-XXXXXX (KST 날짜 + 혼동 문자 제외 랜덤 6자리). */
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
