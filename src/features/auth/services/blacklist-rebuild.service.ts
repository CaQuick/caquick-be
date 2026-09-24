import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { resolveAppRole, runsBackgroundJobs } from '@/config/app.config';
import { BlacklistRebuildRepository } from '@/features/auth/repositories/blacklist-rebuild.repository';
import { TokenBlacklistService } from '@/global/auth/blacklist';

/** 재구축 주기. Redis가 비었을 때 api가 DB 폴백으로 버티는 최대 시간이기도 하다. */
export const BLACKLIST_REBUILD_INTERVAL_MS = 60_000;

/**
 * Redis가 비거나(재시작·flush) 커밋 뒤 등록이 실패했을 때를 위해, worker가 DB에서 블랙리스트를 다시 채운다(P2 03).
 * TTL 창 안의 정지·탈퇴·비밀번호 변경을 다시 등록한 뒤 "완전함" 표식을 세운다 — 표식이 없는 동안 전략은 DB로 폴백한다.
 */
@Injectable()
export class BlacklistRebuildService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(BlacklistRebuildService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repo: BlacklistRebuildRepository,
    private readonly blacklist: TokenBlacklistService,
    private readonly clock: ClockService,
  ) {}

  onApplicationBootstrap(): void {
    if (!runsBackgroundJobs(resolveAppRole())) return;
    void this.rebuildSafely();
    this.timer = setInterval(
      () => void this.rebuildSafely(),
      BLACKLIST_REBUILD_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 한 번 재구축. 테스트가 직접 부른다. 등록 건수를 돌려준다. */
  async rebuild(): Promise<{
    suspended: number;
    deleted: number;
    credentials: number;
  }> {
    const ttl = this.blacklist.accessTtlSeconds();
    const since = new Date(this.clock.now().getTime() - ttl * 1000);
    const [suspended, deleted, credentials] = await Promise.all([
      this.repo.suspendedSince(since),
      this.repo.deletedSince(since),
      this.repo.credentialsChangedSince(since),
    ]);
    // 복구 직후 표식이 있으면 옛 스냅샷으로 정지를 되살리지 않는다(재구축 경쟁)
    for (const id of suspended) {
      await this.blacklist.blockStatusUnlessReinstated(id, 'SUSPENDED');
    }
    for (const id of deleted) await this.blacklist.blockStatus(id, 'DELETED');
    for (const { accountId, changedAt } of credentials) {
      await this.blacklist.blockCredentials(accountId, changedAt);
    }
    await this.blacklist.markReady();
    return {
      suspended: suspended.length,
      deleted: deleted.length,
      credentials: credentials.length,
    };
  }

  private async rebuildSafely(): Promise<void> {
    try {
      const result = await this.rebuild();
      this.logger.log(
        `블랙리스트 재구축 — 정지 ${result.suspended}·탈퇴 ${result.deleted}·자격증명 ${result.credentials}`,
      );
    } catch (error) {
      // 실패하면 표식이 안 세워져 전략이 DB로 폴백한다 — 안전한 쪽
      this.logger.error(
        '블랙리스트 재구축 실패',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
