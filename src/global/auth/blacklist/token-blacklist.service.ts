import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import type { AuthConfig } from '@/config/auth.config';
import { AlertService } from '@/global/alerting';
import { REDIS_CLIENT } from '@/global/redis';

/** 계정 상태로 막는 사유. 자격증명 변경은 별도 키(cutoff)라 여기 없다. */
export type StatusBlockReason = 'SUSPENDED' | 'DELETED';
/** 상태 키의 값 종류. ACTIVE는 복구 기록 — 옛 스냅샷의 정지 등록이 이보다 늦게 와도 덮지 못하게 남긴다. */
type AccountStatusValue = StatusBlockReason | 'ACTIVE';

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
export const STATUS_KEY_PATTERN = `${STATUS_PREFIX}*`;
/** 목록이 완전하다는 표식(TTL 없음). worker의 재구축이 세우고, Redis가 비면 같이 사라진다. */
export const BLACKLIST_READY_KEY = 'auth:blk:ready';

/** JWT iat는 초 단위다. 내림 + `iat < cutoff` 비교라 변경과 같은 초에 새로 받은 토큰은 통과한다(같은 초의 옛 토큰도 — 1초 창). */
export function credentialCutoffSec(changedAt: Date): number {
  return Math.floor(changedAt.getTime() / 1000);
}

/**
 * 모든 쓰기는 "버전이 더 새로울 때만"이다(Lua 1회 왕복). 버전 = DB에 기록한 변경 시각(ms).
 * 훅·재구축·조정이 어떤 순서로 겹쳐도 결과는 가장 최근 변경이 이긴다 — 재구축이 복구 전 스냅샷으로 정지를
 * 되살리거나, 옛 스냅샷이 최신 비밀번호 변경 cutoff를 낮추는 일이 없다.
 */
const SET_IF_NEWER = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local ver = tonumber(string.match(cur, ':(%d+)$') or cur)
  if ver and ver >= tonumber(ARGV[2]) then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1`;

/**
 * 정지·탈퇴·비밀번호 변경 뒤 아직 만료 전인 액세스 토큰을 막는다(P2 E2). 키는 액세스 TTL만큼만 산다 —
 * 그 뒤엔 토큰 자체가 만료라 볼 필요가 없다. 조회 실패는 던진다(전략이 DB 재조회로 폴백).
 * 쓰기는 도메인 트랜잭션이 커밋된 뒤라 실패해도 던지지 않고 경보만 — worker 재구축·조정이 한 주기 안에 메운다.
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly alerts: AlertService,
  ) {}

  /** 정지·탈퇴. changedAt = DB에 기록한 상태 변경 시각. 도메인 트랜잭션이 커밋된 뒤에 부른다. */
  async blockStatus(
    accountId: bigint,
    reason: StatusBlockReason,
    changedAt: Date,
  ): Promise<void> {
    await this.writeStatus(accountId, reason, changedAt);
  }

  /** 복구. 상태 키를 ACTIVE(버전 포함)로 바꾼다 — 자격증명 cutoff는 그대로. */
  async clearStatus(accountId: bigint, changedAt: Date): Promise<void> {
    await this.writeStatus(accountId, 'ACTIVE', changedAt);
  }

  /** 비밀번호 변경·초기화. cutoff 전에 발급된 토큰만 막는다 — 새 비밀번호로 받은 새 토큰은 통과. */
  async blockCredentials(accountId: bigint, changedAt: Date): Promise<void> {
    const cutoff = credentialCutoffSec(changedAt);
    await this.write('credentials', (ttl) =>
      this.redis.eval(
        SET_IF_NEWER,
        1,
        `${CREDENTIAL_PREFIX}${accountId}`,
        cutoff,
        cutoff,
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
      status: parseBlockedStatus(status),
      credentialCutoffSec: cutoff === null ? null : Number(cutoff),
    };
  }

  /** 재구축 조정용 — 지금 막고 있는(SUSPENDED·DELETED) 상태 키의 계정 id 전부. 실패는 던진다. */
  async blockedStatusAccountIds(): Promise<bigint[]> {
    const ids: bigint[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        STATUS_KEY_PATTERN,
        'COUNT',
        200,
      );
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.redis.mget(...keys);
      keys.forEach((key, i) => {
        if (parseBlockedStatus(values[i]) !== null) {
          ids.push(BigInt(key.slice(STATUS_PREFIX.length)));
        }
      });
    } while (cursor !== '0');
    return ids;
  }

  /** 재구축이 끝난 뒤 세운다. 다음 flush까지 남는다. */
  async markReady(): Promise<void> {
    await this.redis.set(BLACKLIST_READY_KEY, '1');
  }

  accessTtlSeconds(): number {
    return this.config.getOrThrow<AuthConfig>('auth').jwtAccessExpiresSeconds;
  }

  private async writeStatus(
    accountId: bigint,
    value: AccountStatusValue,
    changedAt: Date,
  ): Promise<void> {
    const version = changedAt.getTime();
    await this.write(`status ${value}`, (ttl) =>
      this.redis.eval(
        SET_IF_NEWER,
        1,
        `${STATUS_PREFIX}${accountId}`,
        `${value}:${version}`,
        version,
        ttl,
      ),
    );
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

/** `SUSPENDED:<ms>`·`DELETED:<ms>`만 차단. `ACTIVE:<ms>`·없음·알 수 없는 값은 차단 아님. */
function parseBlockedStatus(value: string | null): StatusBlockReason | null {
  if (value === null) return null;
  const reason = value.split(':', 1)[0];
  return reason === 'SUSPENDED' || reason === 'DELETED' ? reason : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
