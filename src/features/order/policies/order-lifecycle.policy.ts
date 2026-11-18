import { DAY_MS, HOUR_MS } from '@/common/utils/kst-time';
import {
  OrderStatus,
  PaymentStatus,
  type Payment,
} from '@/generated/prisma/client';

/** 판매자 확정 마감: 접수(입금 확인) + 24시간과 픽업 시각 중 이른 쪽. 픽업 변경 때도 다시 잰다. */
export function confirmDeadlineFor(submittedAt: Date, pickupAt: Date): Date {
  return new Date(Math.min(submittedAt.getTime() + DAY_MS, pickupAt.getTime()));
}

/** 확정 마감 이만큼 전에 판매자에게 미리 알린다. */
export const CONFIRM_REMINDER_LEAD_MS = 2 * HOUR_MS;

/** 잠금 읽기로 다시 본 주문·결제(크론 대상 재검사 재료). */
export interface OrderLockedState {
  status: OrderStatus;
  pickupAt: Date;
  confirmDeadlineAt: Date | null;
  payment: Pick<Payment, 'status' | 'expires_at' | 'buyer_claimed_at'> | null;
}

export interface ConfirmReminderState {
  status: OrderStatus;
  submittedAt: Date | null;
  confirmDeadlineAt: Date | null;
  confirmReminderSentAt: Date | null;
}

/** 미입금 취소 대상: 유예 없이 입금 기한 정각부터, '입금했어요'를 누른 주문은 관리자 확인을 기다린다. */
export function isPaymentExpired(state: OrderLockedState, now: Date): boolean {
  const { payment } = state;
  return (
    state.status === OrderStatus.PENDING_PAYMENT &&
    payment?.status === PaymentStatus.PENDING &&
    payment.buyer_claimed_at === null &&
    payment.expires_at <= now
  );
}

/** 미확정 취소 대상: 확정 마감이 지난 접수. 결제 도입 전 접수는 마감이 없어 빠진다. */
export function isConfirmTimedOut(state: OrderLockedState, now: Date): boolean {
  return (
    state.status === OrderStatus.SUBMITTED &&
    state.confirmDeadlineAt !== null &&
    state.confirmDeadlineAt <= now
  );
}

/** 마감 2시간 전 구간의 미발송 접수. 접수 시점에 이미 그 구간이었으면(새 주문 푸시가 마감을 실었다) 보내지 않는다. */
export function isConfirmReminderDue(
  state: ConfirmReminderState,
  now: Date,
): boolean {
  const { confirmDeadlineAt: deadline, submittedAt } = state;
  if (
    state.status !== OrderStatus.SUBMITTED ||
    state.confirmReminderSentAt !== null ||
    !deadline ||
    !submittedAt
  ) {
    return false;
  }
  const remindAt = deadline.getTime() - CONFIRM_REMINDER_LEAD_MS;
  return (
    remindAt <= now.getTime() &&
    now < deadline &&
    remindAt > submittedAt.getTime()
  );
}
