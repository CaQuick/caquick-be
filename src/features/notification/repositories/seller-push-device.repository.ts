import { Injectable } from '@nestjs/common';

import type { PushDeviceDisabledReason } from '@/features/notification/constants/seller-push.constants';
import type { Prisma, PushPlatform } from '@/generated/prisma/client';
import { PrismaService } from '@/prisma';

export interface UpsertPushDeviceArgs {
  token: string;
  accountId: bigint;
  storeId: bigint;
  platform: PushPlatform;
  clientDeviceId: string | null;
  seenAt: Date;
}

const activeDeviceSelect = {
  id: true,
  expo_push_token: true,
  platform: true,
} satisfies Prisma.SellerPushDeviceSelect;

export type ActivePushDeviceRow = Prisma.SellerPushDeviceGetPayload<{
  select: typeof activeDeviceSelect;
}>;

/** 판매자 푸시 디바이스. `deleted_at`이 없는 모델이라 활성 판정은 `disabled_at: null`을 명시한다. */
@Injectable()
export class SellerPushDeviceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 토큰 unique 기준 upsert. 기존 행이면 소유 계정·매장을 현재 판매자로 바꾸고 해제 상태를 푼다. */
  async upsertByToken(args: UpsertPushDeviceArgs): Promise<void> {
    const common = {
      account_id: args.accountId,
      store_id: args.storeId,
      platform: args.platform,
      client_device_id: args.clientDeviceId,
      last_seen_at: args.seenAt,
    };
    await this.prisma.sellerPushDevice.upsert({
      where: { expo_push_token: args.token },
      create: { ...common, expo_push_token: args.token },
      update: { ...common, disabled_at: null, disabled_reason: null },
    });
  }

  /** 본인 소유 활성 행만 해제한다. 반환은 해제된 건수(0이면 없거나 남의 토큰). */
  async disableByTokenForAccount(args: {
    token: string;
    accountId: bigint;
    reason: PushDeviceDisabledReason;
    at: Date;
  }): Promise<number> {
    const result = await this.prisma.sellerPushDevice.updateMany({
      where: {
        expo_push_token: args.token,
        account_id: args.accountId,
        disabled_at: null,
      },
      data: { disabled_at: args.at, disabled_reason: args.reason },
    });
    return result.count;
  }

  async listActiveByStore(storeId: bigint): Promise<ActivePushDeviceRow[]> {
    return this.prisma.sellerPushDevice.findMany({
      where: { store_id: storeId, disabled_at: null },
      select: activeDeviceSelect,
      orderBy: { id: 'asc' },
    });
  }

  /** 전송 결과(DeviceNotRegistered 등)로 비활성. 이미 해제된 행은 사유를 덮지 않는다. */
  async disableByIds(
    ids: bigint[],
    reason: PushDeviceDisabledReason,
    at: Date,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.prisma.sellerPushDevice.updateMany({
      where: { id: { in: ids }, disabled_at: null },
      data: { disabled_at: at, disabled_reason: reason },
    });
    return result.count;
  }
}
