import type { PaymentStatus, Prisma } from '@/generated/prisma/client';

const BPS_DENOMINATOR = 10_000;

export interface LockedPayment {
  id: bigint;
  status: PaymentStatus;
  amount: number;
  expires_at: Date;
  buyer_claimed_at: Date | null;
  confirmed_at: Date | null;
}

/** 결제 행을 잠그고 읽는다(잠금 순서 order → payment). 결제 도입 전 주문이면 null. */
export async function lockPayment(
  tx: Prisma.TransactionClient,
  orderId: bigint,
): Promise<LockedPayment | null> {
  const [row] = await tx.$queryRaw<
    (Omit<LockedPayment, 'amount'> & { amount: bigint })[]
  >`
    SELECT id, status, amount, expires_at, buyer_claimed_at, confirmed_at
    FROM payment WHERE order_id = ${orderId} FOR UPDATE`;
  // raw는 INT UNSIGNED를 bigint로 돌려준다
  return row ? { ...row, amount: Number(row.amount) } : null;
}

/** 돈이 있는 주문은 결제가 확인된 주문뿐이다. */
export function confirmedPaidAmount(
  payment: Pick<LockedPayment, 'amount' | 'confirmed_at'> | null,
): number {
  return payment?.confirmed_at ? payment.amount : 0;
}

/** 수수료는 원 미만 버림, 지급액 = 기준액 − 수수료. */
export function settlementAmounts(
  baseAmount: number,
  commissionRateBps: number,
): { commissionAmount: number; payoutAmount: number } {
  const commissionAmount = Math.floor(
    (baseAmount * commissionRateBps) / BPS_DENOMINATOR,
  );
  return { commissionAmount, payoutAmount: baseAmount - commissionAmount };
}

/**
 * 정산 확정: 기준액·수수료·확정 시각을 주문에 고정한다. 기준액은 호출자가 확인된 결제액(confirmedPaidAmount)에서
 * 만든다 — 픽업 완료·노쇼는 결제액, 구매자 사정 취소는 결제액 − 환불액. 0 이하면(미확인·전액 환불) 확정하지 않는다.
 * 주문·결제 행을 잠근 tx 안에서 부른다.
 */
export async function finalizeSettlementLocked(
  tx: Prisma.TransactionClient,
  order: { id: bigint; commission_rate_bps: number },
  baseAmount: number,
  now: Date,
): Promise<boolean> {
  if (baseAmount <= 0) return false;
  const { commissionAmount } = settlementAmounts(
    baseAmount,
    order.commission_rate_bps,
  );
  await tx.order.update({
    where: { id: order.id },
    data: {
      settlement_base_amount: baseAmount,
      commission_amount: commissionAmount,
      settlement_finalized_at: now,
    },
  });
  return true;
}
