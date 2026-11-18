import {
  formatMinutesOfDay,
  kstMinutesOfDay,
  toKstYmd,
} from '@/common/utils/kst-time';
import type { OrderPaymentPendingPayload } from '@/features/order/events/order-payment-pending.event';
import type { PaymentDepositClaimedPayload } from '@/features/order/events/payment-deposit-claimed.event';
import type { RefundEventPayload } from '@/features/order/events/refund-requested.event';
import type { SettlementCreatedPayload } from '@/features/order/events/settlement-created.event';
import { RefundKind } from '@/generated/prisma/client';
import type { AlertMessage } from '@/global/alerting';

const REFUND_KIND_LABELS: Record<RefundKind, string> = {
  [RefundKind.CANCEL]: '취소 환불',
  [RefundKind.DEPOSIT_RETURN]: '입금 반환',
};

/** 관리자 웹 처리 화면 링크. 주소가 설정되지 않았으면 null(링크 없이 보낸다). */
export function adminTaskLink(
  baseUrl: string | null,
  path: string,
  params: Record<string, string>,
): string | null {
  if (!baseUrl) return null;
  return `${baseUrl}${path}?${new URLSearchParams(params).toString()}`;
}

function depositLines(
  p: { orderNumber: string; amount: number; depositorName: string },
  link: string | null,
  extra: string[] = [],
): string {
  return [
    `주문 ${p.orderNumber}`,
    `${p.amount.toLocaleString('ko-KR')}원 · 입금자명 ${p.depositorName}`,
    ...extra,
    ...(link ? [link] : []),
  ].join('\n');
}

/** `M/d HH:mm`(KST). */
function formatKst(date: Date): string {
  const { month, day } = toKstYmd(date);
  return `${month}/${day} ${formatMinutesOfDay(kstMinutesOfDay(date))}`;
}

function depositLink(baseUrl: string | null, orderId: string): string | null {
  return adminTaskLink(baseUrl, '/tasks/deposits', { orderId });
}

export function buildDepositPendingAlert(
  p: OrderPaymentPendingPayload,
  baseUrl: string | null,
): AlertMessage {
  return {
    level: 'info',
    title: '새 입금 대기',
    key: `deposit-pending:${p.orderId}`,
    detail: depositLines(p, depositLink(baseUrl, p.orderId), [
      `입금 기한 ${formatKst(new Date(p.expiresAt))}`,
    ]),
  };
}

export function buildDepositClaimedAlert(
  p: PaymentDepositClaimedPayload,
  baseUrl: string | null,
): AlertMessage {
  return {
    level: 'info',
    title: "입금 확인 요청('입금했어요')",
    key: `deposit-claim:${p.orderId}`,
    detail: depositLines(p, depositLink(baseUrl, p.orderId)),
  };
}

/** 환불 계좌가 들어와 송금할 차례(취소와 함께 입력·나중에 입력·덮어쓰기). 계좌번호는 싣지 않는다. */
export function buildRefundReadyAlert(
  p: RefundEventPayload,
  baseUrl: string | null,
): AlertMessage {
  const link = adminTaskLink(baseUrl, '/tasks/refunds', {
    refundId: p.refundId,
  });
  return {
    level: 'info',
    title: '환불 송금 대기',
    key: `refund-ready:${p.refundId}`,
    detail: [
      `주문 ${p.orderNumber}`,
      `${p.amount.toLocaleString('ko-KR')}원 · ${REFUND_KIND_LABELS[p.kind]}`,
      ...(link ? [link] : []),
    ].join('\n'),
  };
}

/** 매장별 이벤트를 주 단위 key로 묶어 억제 창 안에서 한 번만 보낸다 — 매장별 금액은 처리 화면에서 본다. */
export function buildSettlementCreatedAlert(
  p: SettlementCreatedPayload,
  baseUrl: string | null,
): AlertMessage {
  const link = adminTaskLink(baseUrl, '/tasks/settlements', {
    periodStart: p.periodStart,
  });
  return {
    level: 'info',
    title: '주간 정산 생성',
    key: `settlement-week:${p.periodStart}`,
    detail: [
      `${p.periodStart} ~ ${p.periodEnd} 정산이 생성됐어요. 매장별 정산을 확인하고 송금해 주세요.`,
      ...(link ? [link] : []),
    ].join('\n'),
  };
}
