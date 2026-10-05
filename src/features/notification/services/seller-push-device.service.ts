import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  EXPO_PUSH_TOKEN_PATTERN,
  PUSH_DEVICE_DISABLED_REASON,
} from '@/features/notification/constants/seller-push.constants';
import type { SellerRegisterPushTokenInput } from '@/features/notification/dto/inputs/seller-register-push-token.input';
import type { SellerUnregisterPushTokenInput } from '@/features/notification/dto/inputs/seller-unregister-push-token.input';
import { SellerPushDeviceRepository } from '@/features/notification/repositories/seller-push-device.repository';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import { AccountType } from '@/generated/prisma/client';

/** 판매자 앱 Expo 푸시 토큰 등록·해제. 둘 다 멱등 — 앱이 시작·로그인·로그아웃마다 불러도 된다. */
@Injectable()
export class SellerPushDeviceService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly devices: SellerPushDeviceRepository,
    private readonly clock: ClockService,
  ) {
    super(repo, auditLogs);
  }

  /** 토큰이 식별자라 다른 판매자가 쓰던 토큰도 현재 판매자가 가져간다(앱 재설치·계정 전환). */
  async register(
    accountId: bigint,
    input: SellerRegisterPushTokenInput,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    if (!EXPO_PUSH_TOKEN_PATTERN.test(input.token)) {
      throw new DomainException('INVALID_PUSH_TOKEN');
    }
    await this.devices.upsertByToken({
      token: input.token,
      accountId: ctx.accountId,
      storeId: ctx.storeId,
      platform: input.platform,
      clientDeviceId: input.deviceId ?? null,
      seenAt: this.clock.now(),
    });
    return true;
  }

  /** 로그아웃 경로라 매장 컨텍스트를 요구하지 않는다 — 매장이 없는 판매자도 해제할 수 있어야 한다. */
  async unregister(
    accountId: bigint,
    input: SellerUnregisterPushTokenInput,
  ): Promise<boolean> {
    const account = await this.repo.findSellerAccountContext(accountId);
    if (!account) throw new DomainException('SESSION_ACCOUNT_MISSING');
    if (account.account_type !== AccountType.SELLER) {
      throw new DomainException('SELLER_ONLY');
    }
    await this.devices.disableByTokenForAccount({
      token: input.token,
      accountId: account.id,
      reason: PUSH_DEVICE_DISABLED_REASON.UNREGISTERED,
      at: this.clock.now(),
    });
    return true;
  }
}
