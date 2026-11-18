import { OrderStatus, Prisma } from '@/generated/prisma/client';

/** 계정당 동시 입금 대기 주문 상한. */
export const PENDING_PAYMENT_LIMIT = 2;
/** tx timeout(10초)보다 짧아야 대기 중 tx가 먼저 끊기지 않는다. */
const LOCK_WAIT_SECONDS = 3;

/** GET_LOCK 이름은 서버 전역이라 스키마를 붙인다 — 같은 서버의 다른 스키마에서 같은 계정 id와 겹치지 않게. */
export function pendingPaymentLockName(accountId: bigint): Prisma.Sql {
  return Prisma.sql`CONCAT(DATABASE(), ':pending-payment:', ${accountId})`;
}

/**
 * 같은 계정의 주문 생성을 직렬화한다. GET_LOCK은 연결(세션) 단위라 tx 콜백 안에서 잡고 같은 콜백의 finally에서 푼다 —
 * 커밋 뒤에는 같은 연결로 문장을 보낼 수 없어, 밖에서 풀거나 해제를 빼면 풀 연결에 잠금이 남는다.
 * tx가 timeout으로 만료되면 연결이 이미 풀로 돌아가 해제를 보낼 수 없으므로 tx 밖 클라이언트(`outer`)로 그 세션을 끊는다.
 * 0(시간 초과)·NULL(오류)이면 'lock-timeout'.
 */
export async function withPendingPaymentLock<T>(
  tx: Prisma.TransactionClient,
  outer: Prisma.TransactionClient,
  accountId: bigint,
  fn: () => Promise<T>,
): Promise<T | 'lock-timeout'> {
  const name = pendingPaymentLockName(accountId);
  const [row] = await tx.$queryRaw<
    { acquired: unknown; connectionId: bigint }[]
  >`
    SELECT GET_LOCK(${name}, ${LOCK_WAIT_SECONDS}) AS acquired, CONNECTION_ID() AS connectionId`;
  if (Number(row.acquired) !== 1) return 'lock-timeout';
  try {
    return await fn();
  } finally {
    try {
      await tx.$queryRaw`SELECT RELEASE_LOCK(${name})`;
    } catch {
      // KILL 실패는 무시한다 — 끊을 세션이 이미 없으면 잠금도 이미 풀렸다.
      await Promise.allSettled([outer.$executeRaw`KILL ${row.connectionId}`]);
    }
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
