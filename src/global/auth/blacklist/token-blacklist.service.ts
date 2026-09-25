import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { ClockService } from '@/common/providers/clock.service';
import type { AuthConfig } from '@/config/auth.config';
import { AlertService } from '@/global/alerting';
import { REDIS_CLIENT } from '@/global/redis';

/** 계정 상태로 막는 사유. 자격증명 변경은 별도 키(cutoff)라 여기 없다. */
export type StatusBlockReason = 'SUSPENDED' | 'DELETED';
/** 상태 키의 값 종류. ACTIVE는 복구 기록 — 옛 스냅샷의 정지 등록이 이보다 늦게 와도 덮지 못하게 남긴다. */
type AccountStatusValue = StatusBlockReason | 'ACTIVE';

export interface BlacklistLookup {
  /** 재구축 표식이 있는가. 없으면(Redis 초기화·flush·쓰기 실패 직후) 목록이 불완전하므로 호출자는 DB로 폴백해야 한다. */
  ready: boolean;
  status: StatusBlockReason | null;
  /** 이 시각(초, JWT iat와 같은 정밀도) 전에 발급된 토큰은 무효. 없으면 null. */
  credentialCutoffSec: number | null;
}

/** 두 축을 키로 나눈다 — 정지 등록·복구가 자격증명 cutoff를 덮거나 지우면 안 된다. */
const STATUS_PREFIX = 'auth:blk:st:';
const CREDENTIAL_PREFIX = 'auth:blk:cr:';
export const STATUS_KEY_PATTERN = `${STATUS_PREFIX}*`;
/** SCAN 한 페이지 크기(힌트). spec이 이보다 많은 키로 커서 순회를 고정한다. */
export const STATUS_SCAN_PAGE = 100;
/** 목록이 완전하다는 표식. worker의 재구축이 임대처럼 갱신한다 — worker가 죽거나 Redis가 비면 만료돼 전략이 DB로 폴백한다. */
export const BLACKLIST_READY_KEY = 'auth:blk:ready';
/** 표식 임대 시간. 재구축 주기(60초)의 3배 — 재구축을 연속으로 놓쳐야 폴백으로 돌아간다(주기와의 관계는 재구축 spec이 고정). */
export const BLACKLIST_READY_TTL_SECONDS = 180;
/** 쓰기 실패 세대. 실패마다 올라가고, 재구축은 스냅샷 시점의 세대가 그대로일 때만 표식을 세운다(스냅샷 뒤 실패한 훅과의 경쟁). */
const DIRTY_KEY = 'auth:blk:dirty';

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

/** 세대 키가 없거나(빈 Redis — 재시작이 끼었다) 스냅샷 때와 다르면 세우지 않는다(원자적). */
const MARK_READY_IF_GENERATION = `
local gen = redis.call('GET', KEYS[2])
if not gen or gen ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], '1', 'EX', ARGV[2])
return 1`;

/**
 * 정지·탈퇴·비밀번호 변경 뒤 아직 만료 전인 액세스 토큰을 막는다. 키는 액세스 TTL만큼만 산다 —
 * 그 뒤엔 토큰 자체가 만료라 볼 필요가 없다. 조회 실패는 던진다(전략이 DB 재조회로 폴백).
 * 쓰기는 도메인 트랜잭션이 커밋된 뒤라 실패해도 던지지 않는다 — 대신 경보 + 완전성 표식을 지워 전략이 DB로 폴백하게
 * 하고 false를 돌려준다. worker 재구축·조정이 한 주기 안에 다시 채우고 표식을 세운다.
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);
  /** 표식 제거까지 실패한 뒤 이 시각까지 이 프로세스의 조회는 ready=false(DB 폴백). 다른 프로세스는 표식 임대 만료로 수렴한다. */
  private degradedUntilMs = 0;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly alerts: AlertService,
    private readonly clock: ClockService,
  ) {}

  /** 정지·탈퇴. changedAt = DB에 기록한 상태 변경 시각. 도메인 트랜잭션이 커밋된 뒤에 부른다. false = 쓰기 실패. */
  async blockStatus(
    accountId: bigint,
    reason: StatusBlockReason,
    changedAt: Date,
  ): Promise<boolean> {
    return this.writeStatus(accountId, reason, changedAt);
  }

  /** 복구. 상태 키를 ACTIVE(버전 포함)로 바꾼다 — 자격증명 cutoff는 그대로. false = 쓰기 실패. */
  async clearStatus(accountId: bigint, changedAt: Date): Promise<boolean> {
    return this.writeStatus(accountId, 'ACTIVE', changedAt);
  }

  /** 비밀번호 변경·초기화. cutoff 전에 발급된 토큰만 막는다 — 새 비밀번호로 받은 새 토큰은 통과. false = 쓰기 실패. */
  async blockCredentials(accountId: bigint, changedAt: Date): Promise<boolean> {
    const cutoff = credentialCutoffSec(changedAt);
    return this.write('credentials', (ttl) =>
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
    // 연결 전·재접속 중이면 오프라인 큐에서 commandTimeout(1초)까지 기다린다 — 인증 경로라 기다리지 않고 바로 폴백
    if (this.redis.status !== 'ready') {
      throw new Error(`Redis 연결 상태 ${this.redis.status} — 즉시 폴백`);
    }
    if (this.clock.nowMs() < this.degradedUntilMs) {
      // 표식 제거를 다시 시도해 성공하면 열화를 풀고, 아니면 이 프로세스는 계속 DB로
      if (await this.clearReady()) {
        this.degradedUntilMs = 0;
      } else {
        return { ready: false, status: null, credentialCutoffSec: null };
      }
    }
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
        STATUS_SCAN_PAGE,
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

  /** 표식을 지운다 — 목록을 믿을 수 없다고 판단한 쪽(축출 정책 위험 등)이 부른다. false = 삭제 실패. */
  async invalidateReady(): Promise<boolean> {
    return this.clearReady();
  }

  /** 재구축이 DB 스냅샷을 뜨기 전에 읽는 쓰기 실패 세대. 키를 만들어 둔다 — 빈 Redis(재시작)의 "없음"과 세대 0을 구분하기 위해. 실패는 던진다. */
  async generation(): Promise<string> {
    await this.redis.set(DIRTY_KEY, '0', 'NX');
    return (await this.redis.get(DIRTY_KEY)) ?? '0';
  }

  /** 재구축이 끝난 뒤. 스냅샷 이후 쓰기 실패가 끼어들었거나(세대 변화) Redis가 비었으면 세우지 않고 false. 임대라 주기마다 갱신해야 한다. */
  async markReady(generation: string): Promise<boolean> {
    const result = await this.redis.eval(
      MARK_READY_IF_GENERATION,
      2,
      BLACKLIST_READY_KEY,
      DIRTY_KEY,
      generation,
      BLACKLIST_READY_TTL_SECONDS,
    );
    return result === 1;
  }

  /**
   * 축출 정책 점검. maxmemory가 있는데 noeviction이 아니면 TTL 키(상태·cutoff)가 축출돼도 표식은 남을 수 있다 —
   * `volatile-*`는 TTL 키만 고르고, `allkeys-*`도 표식이 살아남을 수 있다. 위험하면 사유, 안전하면 null. 실패는 던진다.
   */
  async evictionRisk(): Promise<string | null> {
    const maxmemory = await this.configValue('maxmemory');
    const policy = await this.configValue('maxmemory-policy');
    if (maxmemory === '0' || policy === 'noeviction') return null;
    return `maxmemory=${maxmemory} maxmemory-policy=${policy} — noeviction이어야 한다`;
  }

  accessTtlSeconds(): number {
    return this.config.getOrThrow<AuthConfig>('auth').jwtAccessExpiresSeconds;
  }

  private async writeStatus(
    accountId: bigint,
    value: AccountStatusValue,
    changedAt: Date,
  ): Promise<boolean> {
    const version = changedAt.getTime();
    return this.write(`status ${value}`, (ttl) =>
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
  ): Promise<boolean> {
    try {
      await command(this.accessTtlSeconds());
      return true;
    } catch (error) {
      const detail = errorMessage(error);
      void this.alerts.notify({
        level: 'warn',
        title: 'Redis 블랙리스트 등록 실패 — 계정 재조회로 폴백',
        key: 'auth-blacklist-write',
        detail: `${what}: ${detail}`,
      });
      // 순서가 중요하다: ① 세대를 먼저 올려 진행 중인 재구축이 스냅샷 전 세대로 표식을 세우지 못하게 하고, ② 그 다음 표식을 지운다.
      // 반대로 하면 DEL과 INCR 사이에 옛 세대의 markReady가 표식을 되살린다. INCR 실패는 삼킨다 — 쓰기가 막힌 동안은 markReady도 실패한다.
      try {
        await this.redis.incr(DIRTY_KEY);
      } catch {
        // 위와 같은 이유로 삼킨다
      }
      // 빠진 키를 "활성"으로 믿지 않게 표식을 지운다. 단독 DEL이어야 한다 — 쓰기만 거부되는 상태(OOM+noeviction·READONLY·
      // MISCONF)에서 DEL은 통과하지만 MULTI로 묶으면 EXECABORT로 같이 버려진다. 그마저 실패하면 이 프로세스는 임대 시간 동안 스스로 폴백.
      const cleared = await this.clearReady();
      if (!cleared) {
        this.degradedUntilMs =
          this.clock.nowMs() + BLACKLIST_READY_TTL_SECONDS * 1000;
      }
      this.logger.warn(
        `블랙리스트 등록 실패(${what}) — 표식 ${cleared ? '제거' : '제거 실패, 이 프로세스는 DB 폴백'}, 재구축이 메운다: ${detail}`,
      );
      return false;
    }
  }

  private async clearReady(): Promise<boolean> {
    try {
      await this.redis.del(BLACKLIST_READY_KEY);
      return true;
    } catch {
      return false;
    }
  }

  private async configValue(name: string): Promise<string> {
    const reply: unknown = await this.redis.config('GET', name);
    if (!Array.isArray(reply) || typeof reply[1] !== 'string') {
      throw new Error(`CONFIG GET ${name} 응답을 해석할 수 없다`);
    }
    return reply[1];
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
