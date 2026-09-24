import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import type { AuthConfig } from '@/config/auth.config';
import { AlertService } from '@/global/alerting';
import { REDIS_CLIENT } from '@/global/redis';

/** 왜 막혔는지 — 전략이 오류 코드를 고른다(정지·탈퇴는 상태 오류, 자격증명 변경은 토큰 무효). */
export type BlockReason = 'SUSPENDED' | 'DELETED' | 'CREDENTIAL_CHANGED';

export interface BlockEntry {
  reason: BlockReason;
  /** 이 시각(ms) 전에 발급된 토큰만 막는다. 자격증명 변경은 새 비밀번호로 받은 새 토큰을 통과시켜야 한다. 정지·탈퇴는 전부(Infinity). */
  issuedBeforeMs: number;
}

export interface BlacklistLookup {
  /** 재구축 표식이 있는가. 없으면(Redis 초기화·flush) 목록이 불완전하므로 호출자는 DB로 폴백해야 한다. */
  ready: boolean;
  entry: BlockEntry | null;
}

const KEY_PREFIX = 'auth:blk:';
/** 목록이 완전하다는 표식(TTL 없음). worker의 재구축이 세우고, Redis가 비면 같이 사라진다. */
export const BLACKLIST_READY_KEY = 'auth:blk:ready';

/**
 * 정지·탈퇴·비밀번호 변경 뒤 아직 만료 전인 액세스 토큰을 막는다(P2 E2). 키는 액세스 TTL만큼만 산다 —
 * 그 뒤엔 토큰 자체가 만료라 볼 필요가 없다. 조회 실패는 던진다(전략이 DB 재조회로 폴백).
 * 쓰기는 도메인 트랜잭션이 커밋된 뒤라 실패해도 던지지 않고 경보만 — 어차피 worker 재구축이 TTL 창 안에서 메운다.
 */
@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly alerts: AlertService,
  ) {}

  /** 도메인 트랜잭션이 커밋된 뒤에 부른다 — 커밋 전이면 롤백 시 멀쩡한 계정을 막는다. */
  async block(
    accountId: bigint,
    reason: BlockReason,
    options: { issuedBeforeMs?: number; ttlSeconds?: number } = {},
  ): Promise<void> {
    const issuedBeforeMs = options.issuedBeforeMs ?? Number.POSITIVE_INFINITY;
    const ttl = options.ttlSeconds ?? this.accessTtlSeconds();
    try {
      await this.redis.set(
        this.key(accountId),
        `${reason}:${Number.isFinite(issuedBeforeMs) ? issuedBeforeMs : '*'}`,
        'EX',
        ttl,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `블랙리스트 등록 실패(${reason}, account ${accountId}) — 재구축이 메운다: ${detail}`,
      );
      void this.alerts.notify({
        level: 'warn',
        title: 'Redis 블랙리스트 등록 실패',
        key: 'auth-blacklist-write',
        detail: `${reason} account=${accountId.toString()}: ${detail}`,
      });
    }
  }

  async unblock(accountId: bigint): Promise<void> {
    try {
      await this.redis.del(this.key(accountId));
    } catch (error) {
      this.logger.warn(
        `블랙리스트 해제 실패(account ${accountId}) — TTL이 풀어 준다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 표식과 항목을 한 번에 읽는다(MGET). 실패는 그대로 던진다. */
  async lookup(accountId: bigint): Promise<BlacklistLookup> {
    const [ready, raw] = await this.redis.mget(
      BLACKLIST_READY_KEY,
      this.key(accountId),
    );
    return {
      ready: ready !== null,
      entry: raw === null ? null : parseEntry(raw),
    };
  }

  /** 재구축이 끝난 뒤 세운다. 다음 flush까지 남는다. */
  async markReady(): Promise<void> {
    await this.redis.set(BLACKLIST_READY_KEY, '1');
  }

  accessTtlSeconds(): number {
    return this.config.getOrThrow<AuthConfig>('auth').jwtAccessExpiresSeconds;
  }

  private key(accountId: bigint): string {
    return `${KEY_PREFIX}${accountId.toString()}`;
  }
}

function parseEntry(raw: string): BlockEntry {
  const [reason, cutoff] = raw.split(':', 2);
  return {
    reason: reason as BlockReason,
    issuedBeforeMs:
      cutoff === undefined || cutoff === '*'
        ? Number.POSITIVE_INFINITY
        : Number(cutoff),
  };
}
