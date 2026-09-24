import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import type { AuthConfig } from '@/config/auth.config';
import { AlertService } from '@/global/alerting';
import { REDIS_CLIENT } from '@/global/redis';

/** 계정 상태로 막는 사유. 자격증명 변경은 별도 키(cutoff)라 여기 없다. */
export type StatusBlockReason = 'SUSPENDED' | 'DELETED';

export interface BlacklistLookup {
  /** 재구축 표식이 있는가. 없으면(Redis 초기화·flush) 목록이 불완전하므로 호출자는 DB로 폴백해야 한다. */
  ready: boolean;
  status: StatusBlockReason | null;
  /** 이 시각(초, JWT iat와 같은 정밀도) 전에 발급된 토큰은 무효. 없으면 null. */
  credentialCutoffSec: number | null;
}

/** 두 축을 키로 나눈다 — 정지 등록·복구가 자격증명 cutoff를 덮거나 지우면 안 된다. */
const STATUS_PREFIX = 'auth:blk:st:';
const CREDENTIAL_PREFIX = 'auth:blk:cr:';
/** 복구 직후 표식(TTL = 재구축 주기의 2배). 재구축이 복구 전 스냅샷으로 정지를 되살리지 않게 한다. */
const REINSTATED_PREFIX = 'auth:blk:ok:';
export const REINSTATED_TTL_SECONDS = 120;
/** 목록이 완전하다는 표식(TTL 없음). worker의 재구축이 세우고, Redis가 비면 같이 사라진다. */
export const BLACKLIST_READY_KEY = 'auth:blk:ready';

/** JWT iat는 초 단위다. 내림 + `iat < cutoff` 비교라 변경과 같은 초에 새로 받은 토큰은 통과한다(같은 초의 옛 토큰도 — 1초 창). */
export function credentialCutoffSec(changedAt: Date): number {
  return Math.floor(changedAt.getTime() / 1000);
}

/** cutoff는 올라가기만 한다 — 재구축이 읽은 옛 스냅샷이 그 사이 등록된 최신 변경을 덮지 않게. */
const SET_CUTOFF_IF_NEWER = `
local cur = redis.call('GET', KEYS[1])
if cur and tonumber(cur) >= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1`;

/**
 * 정지·탈퇴·비밀번호 변경 뒤 아직 만료 전인 액세스 토큰을 막는다(P2 E2). 키는 액세스 TTL만큼만 산다 —
 * 그 뒤엔 토큰 자체가 만료라 볼 필요가 없다. 조회 실패는 던진다(전략이 DB 재조회로 폴백).
 * 쓰기는 도메인 트랜잭션이 커밋된 뒤라 실패해도 던지지 않고 경보만 — worker 재구축이 TTL 창 안에서 메운다.
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly alerts: AlertService,
  ) {}

  /** 정지·탈퇴. 도메인 트랜잭션이 커밋된 뒤에 부른다 — 커밋 전이면 롤백 시 멀쩡한 계정을 막는다. */
  async blockStatus(
    accountId: bigint,
    reason: StatusBlockReason,
  ): Promise<void> {
    await this.write(`status ${reason}`, (ttl) =>
      this.redis
        .multi()
        .set(`${STATUS_PREFIX}${accountId}`, reason, 'EX', ttl)
        .del(`${REINSTATED_PREFIX}${accountId}`)
        .exec(),
    );
  }

  /** 복구. 상태 키만 지운다(자격증명 cutoff는 그대로) + 재구축 경쟁용 표식. */
  async clearStatus(accountId: bigint): Promise<void> {
    try {
      await this.redis
        .multi()
        .del(`${STATUS_PREFIX}${accountId}`)
        .set(
          `${REINSTATED_PREFIX}${accountId}`,
          '1',
          'EX',
          REINSTATED_TTL_SECONDS,
        )
        .exec();
    } catch (error) {
      this.logger.warn(
        `블랙리스트 상태 해제 실패(account ${accountId}) — TTL이 풀어 준다: ${errorMessage(error)}`,
      );
    }
  }

  /** 재구축 전용 — 복구 직후 표식이 있으면 옛 스냅샷으로 정지를 되살리지 않는다. */
  async blockStatusUnlessReinstated(
    accountId: bigint,
    reason: StatusBlockReason,
  ): Promise<boolean> {
    if ((await this.redis.exists(`${REINSTATED_PREFIX}${accountId}`)) > 0)
      return false;
    await this.blockStatus(accountId, reason);
    return true;
  }

  /** 비밀번호 변경·초기화. cutoff 전에 발급된 토큰만 막는다 — 새 비밀번호로 받은 새 토큰은 통과. */
  async blockCredentials(accountId: bigint, changedAt: Date): Promise<void> {
    await this.write('credentials', (ttl) =>
      this.redis.eval(
        SET_CUTOFF_IF_NEWER,
        1,
        `${CREDENTIAL_PREFIX}${accountId}`,
        credentialCutoffSec(changedAt),
        ttl,
      ),
    );
  }

  /** 표식·상태·cutoff를 한 번에 읽는다(MGET). 실패는 그대로 던진다. */
  async lookup(accountId: bigint): Promise<BlacklistLookup> {
    const [ready, status, cutoff] = await this.redis.mget(
      BLACKLIST_READY_KEY,
      `${STATUS_PREFIX}${accountId}`,
      `${CREDENTIAL_PREFIX}${accountId}`,
    );
    return {
      ready: ready !== null,
      status: status === null ? null : (status as StatusBlockReason),
      credentialCutoffSec: cutoff === null ? null : Number(cutoff),
    };
  }

  /** 재구축이 끝난 뒤 세운다. 다음 flush까지 남는다. */
  async markReady(): Promise<void> {
    await this.redis.set(BLACKLIST_READY_KEY, '1');
  }

  accessTtlSeconds(): number {
    return this.config.getOrThrow<AuthConfig>('auth').jwtAccessExpiresSeconds;
  }

  private async write(
    what: string,
    command: (ttlSeconds: number) => Promise<unknown>,
  ): Promise<void> {
    try {
      await command(this.accessTtlSeconds());
    } catch (error) {
      const detail = errorMessage(error);
      this.logger.warn(
        `블랙리스트 등록 실패(${what}) — 재구축이 메운다: ${detail}`,
      );
      void this.alerts.notify({
        level: 'warn',
        title: 'Redis 블랙리스트 등록 실패',
        key: 'auth-blacklist-write',
        detail: `${what}: ${detail}`,
      });
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
