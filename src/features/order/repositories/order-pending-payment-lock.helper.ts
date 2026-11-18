import { OrderStatus, type Prisma } from '@/generated/prisma/client';

/** 계정당 동시 입금 대기 주문 상한. */
export const PENDING_PAYMENT_LIMIT = 2;
/** tx timeout(10초)보다 짧아야 대기 중 tx가 먼저 끊기지 않는다. */
const LOCK_WAIT_SECONDS = 3;

function lockName(accountId: bigint): string {
  return `pending-payment:${accountId}`;
}

/**
 * 같은 계정의 주문 생성을 직렬화한다. GET_LOCK은 연결(세션) 단위라 tx 콜백 안에서 잡고 같은 콜백의 finally에서 푼다 —
 * 커밋 뒤에는 같은 연결로 문장을 보낼 수 없어, 밖에서 풀거나 해제를 빼면 풀 연결에 잠금이 남는다.
 * 0(시간 초과)·NULL(오류)이면 'lock-timeout'.
 */
export async function withPendingPaymentLock<T>(
  tx: Prisma.TransactionClient,
  accountId: bigint,
  fn: () => Promise<T>,
): Promise<T | 'lock-timeout'> {
  const name = lockName(accountId);
  const [row] = await tx.$queryRaw<{ acquired: unknown }[]>`
    SELECT GET_LOCK(${name}, ${LOCK_WAIT_SECONDS}) AS acquired`;
  if (Number(row.acquired) !== 1) return 'lock-timeout';
  try {
    return await fn();
  } finally {
    await tx.$queryRaw`SELECT RELEASE_LOCK(${name})`;
  }
}

/**
 * 잠금 읽기로 센다 — 앞 요청의 미커밋 INSERT 행에서 기다렸다가 커밋된 값을 보므로,
 * 커밋 직전에 GET_LOCK이 풀려도 3건째가 생기지 않는다.
 */
export async function countPendingPaymentOrdersLocked(
  tx: Prisma.TransactionClient,
  accountId: bigint,
): Promise<number> {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM \`order\`
    WHERE account_id = ${accountId}
      AND status = ${OrderStatus.PENDING_PAYMENT}
      AND deleted_at IS NULL
    FOR SHARE`;
  return Number(row.n);
}
