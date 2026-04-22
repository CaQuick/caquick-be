import type {
  NotificationEvent,
  NotificationType,
  PrismaClient,
  Notification,
} from '@prisma/client';

import { createAccount } from '@/test/factories/account.factory';
import { nextSeq } from '@/test/factories/sequence';

export interface NotificationOverrides {
  account_id?: bigint;
  type?: NotificationType;
  event?: NotificationEvent | null;
  title?: string;
  body?: string;
  read_at?: Date | null;
  created_at?: Date;
  deleted_at?: Date | null;
  store_id?: bigint | null;
  product_id?: bigint | null;
  order_id?: bigint | null;
  order_item_id?: bigint | null;
  review_id?: bigint | null;
}

export async function createNotification(
  prisma: PrismaClient,
  overrides: NotificationOverrides = {},
): Promise<Notification> {
  const seq = nextSeq();
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;

  return prisma.notification.create({
    data: {
      account_id: accountId,
      type: overrides.type ?? 'SYSTEM',
      event: overrides.event === undefined ? null : overrides.event,
      title: overrides.title ?? `알림 ${seq}`,
      body: overrides.body ?? `알림 본문 ${seq}`,
      read_at: overrides.read_at === undefined ? null : overrides.read_at,
      ...(overrides.created_at ? { created_at: overrides.created_at } : {}),
      deleted_at: overrides.deleted_at ?? null,
      store_id: overrides.store_id ?? null,
      product_id: overrides.product_id ?? null,
      order_id: overrides.order_id ?? null,
      order_item_id: overrides.order_item_id ?? null,
      review_id: overrides.review_id ?? null,
    },
  });
}
