import type { OrderStatus } from '@/generated/prisma/client';

/** 상태 분류 정본. 새 상태는 여기서 분류하기 전까지 tsc가 막는다(순서는 흐름 순). */
export const ORDER_STATUS_TRAITS = {
  PENDING_PAYMENT: { inProgress: true },
  SUBMITTED: { inProgress: true },
  CONFIRMED: { inProgress: true },
  MADE: { inProgress: true },
  PICKED_UP: { inProgress: false },
  NO_SHOW: { inProgress: false },
  CANCELED: { inProgress: false },
} as const satisfies Record<OrderStatus, { inProgress: boolean }>;

/** 진행 중 주문: 입금 대기부터 제작 완료까지. 마이페이지 진행 주문·관리자 진행 주문 필터·요약이 쓴다. */
export const IN_PROGRESS_ORDER_STATUSES: readonly OrderStatus[] = (
  Object.keys(ORDER_STATUS_TRAITS) as OrderStatus[]
).filter((status) => ORDER_STATUS_TRAITS[status].inProgress);
