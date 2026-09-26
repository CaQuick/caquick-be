import { Prisma } from '@/generated/prisma/client';

/**
 * 지역 FK를 잇는 쓰기(매장 연결·하위 생성·2차 재활성화)는 같은 트랜잭션에서 지역 행을 FOR SHARE로
 * 잠근다 — 지역 삭제·비활성화(FOR UPDATE)와 직렬화되어, 그쪽 커밋 뒤 FK 갱신만 통과해 삭제된
 * 지역에 매달리는 일이 없다. 잠긴 시점에 쓸 수 있는 상태(레벨·활성·미삭제)여야 true.
 */
export async function lockUsableRegion(
  tx: Prisma.TransactionClient,
  regionId: bigint,
  level: 1 | 2,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM region
    WHERE id = ${regionId} AND level = ${level}
      AND is_active = 1 AND deleted_at IS NULL
    FOR SHARE`;
  return rows.length > 0;
}
