import {
  formatMinutesOfDay,
  kstMinutesOfDay,
  toKstYmd,
} from '@/common/utils/kst-time';
import type { OrderPaymentPendingPayload } from '@/features/order/events/order-payment-pending.event';
import type { PaymentDepositClaimedPayload } from '@/features/order/events/payment-deposit-claimed.event';
import type { AlertMessage } from '@/global/alerting';

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
