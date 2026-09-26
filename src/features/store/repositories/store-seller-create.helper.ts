import { DomainException } from '@/common/errors/error-catalog';
import { Prisma, type Store } from '@/generated/prisma/client';

/**
 * 판매자 계정 생성 tx 안에서 매장 행을 만든다(P1-7: 코드 소유 catalog, tx 조정 identity).
 * 지역 FK를 잇는 쓰기는 지역 행을 FOR SHARE로 잠근다 — 지역 삭제·비활성화(FOR UPDATE)와 직렬화되어
 * 삭제된 지역에 매달리는 매장이 생기지 않는다. 선택 가능한 지역은 2단계·활성·미삭제뿐이다.
 */
export async function createStoreForSeller(
  tx: Prisma.TransactionClient,
  args: {
    sellerAccountId: bigint;
    store: Omit<Prisma.StoreUncheckedCreateInput, 'seller_account_id'>;
  },
): Promise<Store> {
  if (args.store.region_id != null) {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      SELECT id FROM region
      WHERE id = ${BigInt(args.store.region_id)} AND level = 2
        AND is_active = 1 AND deleted_at IS NULL
      FOR SHARE`;
    if (rows.length === 0) throw new DomainException('REGION_NOT_SELECTABLE');
  }
  return tx.store.create({
    data: { ...args.store, seller_account_id: args.sellerAccountId },
  });
}
