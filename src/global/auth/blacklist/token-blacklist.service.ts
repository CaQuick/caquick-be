import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import type { AuthConfig } from '@/config/auth.config';
import { REDIS_CLIENT } from '@/global/redis';

/** 왜 막혔는지 — 전략이 오류 코드를 고른다(정지·탈퇴는 상태 오류, 자격증명 변경은 토큰 무효). */
export type BlockReason = 'SUSPENDED' | 'DELETED' | 'CREDENTIAL_CHANGED';

const KEY_PREFIX = 'auth:blk:';

/**
 * 정지·탈퇴·비밀번호 변경 뒤 아직 만료 전인 액세스 토큰을 막는다(P2 E2). 키는 액세스 TTL만큼만 산다 —
 * 그 뒤엔 토큰 자체가 만료라 볼 필요가 없다. 조회 실패는 던진다(전략이 DB 재조회로 폴백).
 */
@Injectable()
export class TokenBlacklistService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  /** 도메인 트랜잭션이 커밋된 뒤에 부른다 — 커밋 전이면 롤백 시 멀쩡한 계정을 막는다. */
  async block(
    accountId: bigint,
    reason: BlockReason,
    ttlSeconds = this.config.getOrThrow<AuthConfig>('auth')
      .jwtAccessExpiresSeconds,
  ): Promise<void> {
    await this.redis.set(this.key(accountId), reason, 'EX', ttlSeconds);
  }

  async unblock(accountId: bigint): Promise<void> {
    await this.redis.del(this.key(accountId));
  }

  async blockedReason(accountId: bigint): Promise<BlockReason | null> {
    const value = await this.redis.get(this.key(accountId));
    return value === null ? null : (value as BlockReason);
  }

  private key(accountId: bigint): string {
    return `${KEY_PREFIX}${accountId.toString()}`;
  }
}
