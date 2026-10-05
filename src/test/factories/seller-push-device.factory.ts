import { randomUUID } from 'node:crypto';

import type {
  PrismaClient,
  PushPlatform,
  SellerPushDelivery,
  SellerPushDeliveryStatus,
  SellerPushDevice,
} from '@/generated/prisma/client';
import { setupSellerWithStore } from '@/test/factories/seller.factory';
import { nextSeq } from '@/test/factories/sequence';

export interface SellerPushDeviceOverrides {
  account_id?: bigint;
  store_id?: bigint;
  expo_push_token?: string;
  platform?: PushPlatform;
  client_device_id?: string | null;
  last_seen_at?: Date;
  disabled_at?: Date | null;
  disabled_reason?: string | null;
}

export function expoPushToken(seq: number = nextSeq()): string {
  return `ExponentPushToken[dev-${seq}]`;
}

/** account_id·store_id를 둘 다 안 주면 매장 있는 판매자를 새로 만든다 — 하나만 주면 나머지는 그 값과 무관한 새 판매자다. */
export async function createSellerPushDevice(
  prisma: PrismaClient,
  overrides: SellerPushDeviceOverrides = {},
): Promise<SellerPushDevice> {
  const seq = nextSeq();
  let accountId = overrides.account_id;
  let storeId = overrides.store_id;
  if (accountId === undefined || storeId === undefined) {
    const seller = await setupSellerWithStore(prisma);
    accountId ??= seller.account.id;
    storeId ??= seller.store.id;
  }

  return prisma.sellerPushDevice.create({
    data: {
      account_id: accountId,
      store_id: storeId,
      expo_push_token: overrides.expo_push_token ?? expoPushToken(seq),
      platform: overrides.platform ?? 'IOS',
      client_device_id:
        overrides.client_device_id === undefined
          ? `device-${seq}`
          : overrides.client_device_id,
      last_seen_at: overrides.last_seen_at ?? new Date(),
      disabled_at: overrides.disabled_at ?? null,
      disabled_reason: overrides.disabled_reason ?? null,
    },
  });
}

export interface SellerPushDeliveryOverrides {
  source_event_id?: string;
  push_device_id?: bigint;
  status?: SellerPushDeliveryStatus;
  ticket_id?: string | null;
  error_code?: string | null;
  sent_at?: Date | null;
  receipt_checked_at?: Date | null;
}

export async function createSellerPushDelivery(
  prisma: PrismaClient,
  overrides: SellerPushDeliveryOverrides = {},
): Promise<SellerPushDelivery> {
  const deviceId =
    overrides.push_device_id ?? (await createSellerPushDevice(prisma)).id;

  return prisma.sellerPushDelivery.create({
    data: {
      source_event_id: overrides.source_event_id ?? randomUUID(),
      push_device_id: deviceId,
      status: overrides.status ?? 'PENDING',
      ticket_id: overrides.ticket_id ?? null,
      error_code: overrides.error_code ?? null,
      sent_at: overrides.sent_at ?? null,
      receipt_checked_at: overrides.receipt_checked_at ?? null,
    },
  });
}
