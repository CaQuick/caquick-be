import { activeOrNull } from '@/common/utils/active-or-null';
import type { AdminStoreDetailRow } from '@/features/store/repositories/store-admin.repository';
import { toStoreOutput } from '@/features/store/services/store-output-mappers.helper';
import type {
  AdminStoreDetailOutput,
  AdminStoreOutput,
} from '@/features/store/types/store-admin-output.type';
import type { Store } from '@/generated/prisma/client';

/** 판매자 SellerStore와 같은 원본에 관리자 전용 표시값(판매자 라벨 스냅샷)을 더한다. */
export function toAdminStoreOutput(row: Store): AdminStoreOutput {
  return {
    ...toStoreOutput(row),
    sellerLabel: row.seller_label_snapshot,
  };
}

export function toAdminStoreDetailOutput(
  row: AdminStoreDetailRow,
): AdminStoreDetailOutput {
  const { seller_account, _count, ...store } = row;
  const credential = activeOrNull(seller_account.credential);
  return {
    store: toAdminStoreOutput(store),
    seller: {
      accountId: seller_account.id.toString(),
      username: credential?.username ?? null,
      email: seller_account.email,
      name: seller_account.name,
      status: seller_account.status,
    },
    productCount: _count.products,
    orderItemCount: _count.order_items,
  };
}
