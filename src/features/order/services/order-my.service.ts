import { Injectable } from '@nestjs/common';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import { calcDiscountRate } from '@/common/utils/discount-rate';
import { parseId } from '@/common/utils/id-parser';
import { sliceOverfetched } from '@/common/utils/pagination';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import type { CancelMyOrderInput } from '@/features/order/dto/inputs/cancel-my-order.input';
import type { MyOrdersInput } from '@/features/order/dto/inputs/my-orders.input';
import type { RefundAccountInput } from '@/features/order/dto/inputs/refund-account.input';
import type { SubmitMyRefundAccountInput } from '@/features/order/dto/inputs/submit-my-refund-account.input';
import { OrderCancelPolicy } from '@/features/order/policies/order-cancel.policy';
import { OrderTransitionRepository } from '@/features/order/repositories/order-transition.repository';
import { OrderRepository } from '@/features/order/repositories/order.repository';
import { PaymentRepository } from '@/features/order/repositories/payment.repository';
import {
  type RefundAccountData,
  RefundRepository,
} from '@/features/order/repositories/refund.repository';
import { normalizeBankAccount } from '@/features/order/services/order-bank-account.helper';
import { OrderEventsService } from '@/features/order/services/order-events.service';
import {
  toOrderCancellation,
  toOrderItemDetail,
  toOrderPickupChange,
  toOrderRefund,
  toOrderStatusHistory,
} from '@/features/order/services/order-output-mappers.helper';
import { toOrderPaymentOutput } from '@/features/order/services/order-payment-mappers.helper';
import type {
  MyOrderConnection,
  MyOrderDetail,
} from '@/features/order/types/order-my-output.type';
import { formatBusinessHours } from '@/features/store';
import {
  OrderActor,
  OrderCancelReason,
  OrderStatus,
  PaymentStatus,
} from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';

@Injectable()
export class UserOrderService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly payments: PaymentRepository,
    private readonly transitions: OrderTransitionRepository,
    private readonly cancelPolicy: OrderCancelPolicy,
    private readonly events: OrderEventsService,
    private readonly clock: ClockService,
    private readonly refunds: RefundRepository,
    private readonly cipher: AccountCipher,
  ) {}

  /**
   * 판매자 확정 전까지만. 입금 대기면 환불 없이, 접수면 전액 환불로 취소한다('입금했어요'를 눌렀어도 허용).
   * 환불 계좌를 함께 받으면 환불이 바로 송금 대기가 된다.
   */
  async cancelMyOrder(
    accountId: bigint,
    input: CancelMyOrderInput,
  ): Promise<MyOrderDetail> {
    const orderId = parseId(input.orderId);
    const note = cleanNullableText(input.note, MAX_REASON_LENGTH);
    const refundAccount = input.refundAccount
      ? this.encryptRefundAccount(input.refundAccount)
      : null;
    const updated = await this.transitions.cancel({
      orderId,
      actor: OrderActor.BUYER,
      actorAccountId: accountId,
      scope: { kind: 'buyer', accountId },
      note,
      refundAccount,
      now: this.clock.now(),
      decide: (state) =>
        this.cancelPolicy.decide(
          {
            actor: OrderActor.BUYER,
            reason: OrderCancelReason.BUYER_REQUEST,
          },
          state,
        ),
    });
    if (!updated) throw new DomainException('ORDER_NOT_FOUND');
    await this.events.publishSellerStatusChanged(updated);
    return this.getMyOrder(accountId, orderId);
  }

  /** 돌려받을 계좌 입력. 송금 완료 전이면 덮어쓸 수 있고, 입력하면 송금 대기가 된다. */
  async submitMyRefundAccount(
    accountId: bigint,
    input: SubmitMyRefundAccountInput,
  ): Promise<MyOrderDetail> {
    const refundId = parseId(input.refundId);
    const result = await this.refunds.submitAccount({
      refundId,
      accountId,
      account: this.encryptRefundAccount(input),
      now: this.clock.now(),
    });
    if (result === 'not-found') throw new DomainException('REFUND_NOT_FOUND');
    if (result === 'completed') {
      throw new DomainException('REFUND_ALREADY_COMPLETED');
    }
    return this.getMyOrder(accountId, result.orderId);
  }

  private encryptRefundAccount(input: RefundAccountInput): RefundAccountData {
    const account = normalizeBankAccount(input);
    return {
      bankCode: account.bankCode,
      accountHolder: account.accountHolder,
      accountNumberEnc: this.cipher.encrypt(
        account.accountNumber,
        'refund-account',
      ),
      accountNumberLast4: account.accountNumber.slice(-4),
    };
  }

  /** '입금했어요'. 마감 전 첫 누름만 기록해 미입금 자동 취소에서 빼고, 다시 누르면 그대로 돌려준다. */
  async markMyOrderDepositSent(
    accountId: bigint,
    orderId: bigint,
  ): Promise<MyOrderDetail> {
    const result = await this.payments.markDepositClaimed({
      orderId,
      accountId,
      now: this.clock.now(),
    });
    if (result === 'not-found') throw new DomainException('ORDER_NOT_FOUND');
    if (result === 'not-pending') {
      throw new DomainException('PAYMENT_NOT_PENDING');
    }
    if (result === 'deadline-passed') {
      throw new DomainException('PAYMENT_DEADLINE_PASSED');
    }
    return this.getMyOrder(accountId, orderId);
  }

  async listMyOrders(
    accountId: bigint,
    input?: MyOrdersInput,
  ): Promise<MyOrderConnection> {
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 20;
    const statuses = input?.statuses;

    const [orders, totalCount] = await Promise.all([
      this.orderRepository.findOrdersByAccount({
        accountId,
        statuses,
        offset,
        limit: limit + 1,
      }),
      this.orderRepository.countOrdersByAccount({
        accountId,
        statuses,
      }),
    ]);

    const { items: sliced, hasMore } = sliceOverfetched(orders, limit);

    // N+1 회피: PICKED_UP + 미작성 리뷰가 있는 order id 집합을 단일 IN 쿼리로 조회
    const reviewableOrderIds =
      await this.orderRepository.findReviewableOrderIds({
        accountId,
        orderIds: sliced.map((o) => o.id),
      });

    return {
      items: sliced.map((order) => {
        const firstItem = order.items[0];
        const itemCount = order._count.items;

        return {
          orderId: order.id.toString(),
          orderNumber: order.order_number,
          status: order.status,
          createdAt: order.created_at,
          pickupAt: order.pickup_at,
          representativeProductName:
            firstItem?.product_name_snapshot ?? '상품 정보 없음',
          representativeProductImageUrl:
            firstItem?.product_thumbnail_url_snapshot ?? null,
          additionalItemCount: Math.max(0, itemCount - 1),
          // 주문 기준: 할인 전 합계를 정가, 할인 뒤 금액을 판매가로 본다(옵션 추가금은 할인 대상 아님)
          discountRate: calcDiscountRate(
            order.subtotal_price,
            order.subtotal_price - order.discount_price,
          ),
          totalPrice: order.total_price,
          storeName: firstItem?.store_name_snapshot ?? '매장 정보 없음',
          regionLabel: firstItem?.store_region_label_snapshot ?? null,
          hasReviewableItem: reviewableOrderIds.has(order.id.toString()),
          paymentExpiresAt:
            order.payment?.status === PaymentStatus.PENDING
              ? order.payment.expires_at
              : null,
        };
      }),
      totalCount,
      hasMore,
    };
  }

  async getMyOrder(accountId: bigint, orderId: bigint): Promise<MyOrderDetail> {
    const order = await this.orderRepository.findOrderDetailByAccount({
      orderId,
      accountId,
    });

    if (!order) {
      throw new DomainException('ORDER_NOT_FOUND');
    }

    const firstItem = order.items[0];
    const store = firstItem?.store;
    const isPickedUp = order.status === OrderStatus.PICKED_UP;

    return {
      orderId: order.id.toString(),
      orderNumber: order.order_number,
      status: order.status,
      createdAt: order.created_at,
      pickupAt: order.pickup_at,
      buyerName: order.buyer_name,
      buyerPhone: order.buyer_phone,
      requestNote: order.request_note,
      payment: order.payment ? toOrderPaymentOutput(order.payment) : null,
      subtotalPrice: order.subtotal_price,
      discountPrice: order.discount_price,
      totalPrice: order.total_price,
      submittedAt: order.submitted_at,
      confirmedAt: order.confirmed_at,
      madeAt: order.made_at,
      pickedUpAt: order.picked_up_at,
      canceledAt: order.canceled_at,
      cancellation: toOrderCancellation(order),
      canCancel: this.cancelPolicy.canCancel(OrderActor.BUYER, order.status),
      refunds: order.refunds.map(toOrderRefund),
      pickupChanges: order.pickup_changes.map(toOrderPickupChange),
      statusHistories: order.status_histories.map(toOrderStatusHistory),
      items: order.items.map((item) => ({
        item: toOrderItemDetail(item),
        representativeImageUrl: item.product_thumbnail_url_snapshot,
        hasMyReview: Boolean(item.review && !item.review.deleted_at),
        canWriteReview:
          isPickedUp && (!item.review || Boolean(item.review.deleted_at)),
      })),
      store: store
        ? {
            storeId: store.id.toString(),
            // 매장명은 주문 시점 스냅샷, 연락처·주소는 현재 매장 정보
            storeName: firstItem.store_name_snapshot,
            storePhone: store.store_phone,
            addressFull: store.address_full,
            addressCity: store.address_city,
            addressDistrict: store.address_district,
            addressNeighborhood: store.address_neighborhood,
            latitude: store.latitude ? Number(store.latitude) : null,
            longitude: store.longitude ? Number(store.longitude) : null,
            businessHoursText: formatBusinessHours(
              store.business_hours,
              store.business_hours_text,
            ),
            websiteUrl: store.website_url,
          }
        : {
            storeId: '0',
            storeName: '매장 정보 없음',
            storePhone: '',
            addressFull: '',
            addressCity: null,
            addressDistrict: null,
            addressNeighborhood: null,
            latitude: null,
            longitude: null,
            businessHoursText: null,
            websiteUrl: null,
          },
    };
  }
}
