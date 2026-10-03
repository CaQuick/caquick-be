import { Injectable } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { LocationAccessLogRepository } from '@/features/region/repositories/location-access-log.repository';
import type { LocationAccessPurpose } from '@/generated/prisma/client';

/** 위치정보법상 확인자료는 6개월 이상 보존한다 — 경계에서 모자라지 않게 여유를 둔다. */
export const LOCATION_ACCESS_LOG_RETENTION_DAYS = 190;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class LocationAccessLogService {
  constructor(
    private readonly repo: LocationAccessLogRepository,
    private readonly clock: ClockService,
  ) {}

  record(
    accountId: bigint | null,
    purpose: LocationAccessPurpose,
  ): Promise<void> {
    return this.repo.record({ accountId, purpose, at: this.clock.now() });
  }

  /** 보존 기간이 지난 행을 지우고 지운 수를 돌려준다. */
  purgeExpired(): Promise<number> {
    const cutoff = new Date(
      this.clock.now().getTime() - LOCATION_ACCESS_LOG_RETENTION_DAYS * DAY_MS,
    );
    return this.repo.deleteCreatedBefore(cutoff);
  }
}
