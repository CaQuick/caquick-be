import type { OrderCancelReason } from '@/generated/prisma/client';

/** 취소 사유 표시 라벨. 주문 상세 reasonLabel과 구매자 취소 알림 본문이 같은 값을 쓴다. */
export const ORDER_CANCEL_REASON_LABELS = {
  DESIGN_NOT_FEASIBLE: '제작할 수 없는 디자인',
  OUT_OF_MATERIALS: '재료 소진',
  SCHEDULE_UNAVAILABLE: '일정 불가',
  INAPPROPRIATE_REQUEST: '부적절한 요청',
  BUYER_REQUEST: '구매자 요청',
  OTHER: '기타',
  PAYMENT_NOT_RECEIVED: '미입금',
  CONFIRM_TIMEOUT: '판매자 미확정',
} as const satisfies Record<OrderCancelReason, string>;
