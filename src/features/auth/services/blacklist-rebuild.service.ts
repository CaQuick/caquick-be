import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { resolveAppRole, runsBackgroundJobs } from '@/config/app.config';
import { BlacklistRebuildRepository } from '@/features/auth/repositories/blacklist-rebuild.repository';
import { AlertService } from '@/global/alerting';
import { TokenBlacklistService } from '@/global/auth/blacklist';

/** 재구축 주기. Redis가 비었을 때 api가 DB 폴백으로 버티는 최대 시간이기도 하다. */
export const BLACKLIST_REBUILD_INTERVAL_MS = 60_000;

/**
 * Redis가 비거나(재시작·flush) 커밋 뒤 등록이 실패했을 때를 위해, worker가 DB에서 블랙리스트를 다시 채운다(P2 03).
 * TTL 창 안의 정지·탈퇴·비밀번호 변경을 다시 등록하고, Redis에 정지·탈퇴로 남았지만 DB에선 활성인 계정(복구 쓰기가
 * 실패한 경우)을 복구로 덮은 뒤 "완전함" 표식을 세운다 — 표식이 없는 동안 전략은 DB로 폴백한다.
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
    private readonly alerts: AlertService,
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

  /** 한 번 재구축. 테스트가 직접 부른다. 등록·조정 건수를 돌려준다. */
  async rebuild(): Promise<{
    suspended: number;
    deleted: number;
    credentials: number;
    reconciled: number;
  }> {
    // TTL 키만 축출되고 표식은 남는 설정이면 표식 자체를 믿을 수 없다 — 세우지 않고 크게 알린다
    const risk = await this.blacklist.evictionRisk();
    if (risk !== null) {
      void this.alerts.notify({
        level: 'error',
        title:
          'Redis 축출 정책이 블랙리스트에 안전하지 않다 — 표식을 세우지 않는다',
        key: 'auth-blacklist-eviction-policy',
        detail: risk,
      });
      throw new Error(`Redis 축출 정책 위험(${risk}) — DB 폴백 유지`);
    }
    // 스냅샷 전에 세대를 읽는다 — 그 뒤 실패한 훅이 끼어들면 세대가 달라져 표식을 세우지 못한다
    const generation = await this.blacklist.generation();
    const ttl = this.blacklist.accessTtlSeconds();
    const since = new Date(this.clock.now().getTime() - ttl * 1000);
    const [suspended, deleted, credentials, blocked] = await Promise.all([
      this.repo.suspendedSince(since),
      this.repo.deletedSince(since),
      this.repo.credentialsChangedSince(since),
      this.blacklist.blockedStatusAccountIds(),
    ]);
    // 쓰기는 전부 "버전이 더 새로울 때만"이라 훅과 겹쳐도 최근 변경이 이긴다
    const results: boolean[] = [];
    for (const { accountId, changedAt } of suspended) {
      results.push(
        await this.blacklist.blockStatus(accountId, 'SUSPENDED', changedAt),
      );
    }
    for (const { accountId, changedAt } of deleted) {
      results.push(
        await this.blacklist.blockStatus(accountId, 'DELETED', changedAt),
      );
    }
    for (const { accountId, changedAt } of credentials) {
      results.push(await this.blacklist.blockCredentials(accountId, changedAt));
    }
    // 조정: 복구 쓰기가 실패해 정지로 남은 계정을 DB 기준으로 되돌린다(TTL까지 잘못 막히지 않게)
    const reinstated = await this.repo.activeAmong(blocked);
    for (const { accountId, changedAt } of reinstated) {
      results.push(await this.blacklist.clearStatus(accountId, changedAt));
    }
    // 하나라도 못 적었으면 목록이 불완전하다 — 표식을 세우면 전략이 빠진 키를 "활성"으로 믿는다
    const failed = results.filter((ok) => !ok).length;
    if (failed > 0) {
      throw new Error(
        `블랙리스트 쓰기 ${failed}건 실패 — 표식을 세우지 않는다(DB 폴백 유지)`,
      );
    }
    if (!(await this.blacklist.markReady(generation))) {
      throw new Error(
        '재구축 중 쓰기 실패가 끼어들었다(세대 변화) — 표식을 세우지 않는다, 다음 주기에 다시',
      );
    }
    return {
      suspended: suspended.length,
      deleted: deleted.length,
      credentials: credentials.length,
      reconciled: reinstated.length,
    };
  }

  private async rebuildSafely(): Promise<void> {
    try {
      const result = await this.rebuild();
      this.logger.log(
        `블랙리스트 재구축 — 정지 ${result.suspended}·탈퇴 ${result.deleted}·자격증명 ${result.credentials}·조정 ${result.reconciled}`,
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
