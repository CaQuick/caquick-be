import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type Redis from 'ioredis';

import { DomainException, type ErrorCode } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import { sha256Hex } from '@/common/utils/crypto';
import { clientIpOf } from '@/common/utils/http-meta';
import { requestOfContext } from '@/global/auth/guards/request-of-context.helper';
import { REDIS_CLIENT } from '@/global/redis';

export interface RateLimitPolicy {
  /** 키 이름공간. 엔드포인트마다 다르게 둬야 서로의 한도를 나눠 쓰지 않는다. */
  name: string;
  /** 창 하나에서 허용하는 호출 수. */
  limit: number;
  windowSeconds: number;
  /** 키 주체. 기본 ip. ip+username은 바디 username(trim·lowercase 해시)을 IP에 덧붙이고, username이 없으면 IP만 쓴다. */
  subject?: 'ip' | 'ip+username';
  /** 초과 시 던질 코드. 기본 RATE_LIMITED. 메시지 파라미터로 { minutes }를 넘긴다. */
  code?: ErrorCode;
}

export const RATE_LIMIT_METADATA_KEY = 'rate-limit:policy';

/** 창 번호가 키에 들어 있어 TTL은 정리용이다 — 창 안 첫 호출에만 건다. */
const INCR_WITH_TTL = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

/** 원문 대신 해시 앞 16자 — 키에 계정명이 남지 않고 길이·구분자 문제도 없다. */
function usernameSegment(req: Request): string | undefined {
  const raw: unknown = (req.body as Record<string, unknown> | undefined)
    ?.username;
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().toLowerCase();
  return normalized ? sha256Hex(normalized).slice(0, 16) : undefined;
}

/**
 * 클라이언트 IP별 고정 창 호출 제한. IP는 trust proxy를 거친 req.ip다.
 * 정책이 여럿이면 전부 센 뒤 판정한다 — 하나가 넘어도 나머지 창이 정확해야 한다.
 * Redis 장애면 통과시킨다 — 남용 방지 장치가 정상 사용자를 막으면 안 된다.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly clock: ClockService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const raw = this.reflector.get<
      RateLimitPolicy | RateLimitPolicy[] | undefined
    >(RATE_LIMIT_METADATA_KEY, context.getHandler());
    const policies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (policies.length === 0) return true;

    const req = requestOfContext(context);
    const ip = clientIpOf(req);
    const nowSeconds = this.clock.now().getTime() / 1000;
    let exceeded: RateLimitPolicy | undefined;
    for (const policy of policies) {
      const window = Math.floor(nowSeconds / policy.windowSeconds);
      const subject =
        policy.subject === 'ip+username' ? usernameSegment(req) : undefined;
      const key = [`rl:${policy.name}`, ip, subject, window]
        .filter((part) => part !== undefined)
        .join(':');
      let count: number;
      try {
        count = Number(
          await this.redis.eval(
            INCR_WITH_TTL,
            1,
            key,
            String(policy.windowSeconds),
          ),
        );
      } catch (error) {
        this.logger.warn(
          `레이트리밋 확인 실패(${policy.name}) — 통과시킴: ${error instanceof Error ? error.message : String(error)}`,
        );
        return true;
      }
      if (count > policy.limit) exceeded ??= policy;
    }
    if (exceeded) {
      throw new DomainException(exceeded.code ?? 'RATE_LIMITED', {
        minutes: Math.ceil(exceeded.windowSeconds / 60),
      });
    }
    return true;
  }
}
