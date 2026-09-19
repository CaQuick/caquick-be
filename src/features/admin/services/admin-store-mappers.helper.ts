import { activeOrNull } from '@/common/utils/active-or-null';
import type { AdminStoreDetailRow } from '@/features/admin/repositories/admin.repository';
import type { AdminStoreDetailOutput } from '@/features/admin/types/admin-output.type';
import { toStoreOutput } from '@/features/store';

export function toAdminStoreDetailOutput(
  row: AdminStoreDetailRow,
): AdminStoreDetailOutput {
  const { seller_account, _count, ...store } = row;
  const credential = activeOrNull(seller_account.credential);
  return {
    store: toStoreOutput(store),
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
