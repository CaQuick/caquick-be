import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type Redis from 'ioredis';

import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import { clientIpOf } from '@/common/utils/http-meta';
import { requestOfContext } from '@/global/auth/guards/request-of-context.helper';
import { REDIS_CLIENT } from '@/global/redis';

export interface RateLimitPolicy {
  /** 키 이름공간. 엔드포인트마다 다르게 둬야 서로의 한도를 나눠 쓰지 않는다. */
  name: string;
  /** 창 하나에서 허용하는 호출 수. */
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMIT_METADATA_KEY = 'rate-limit:policy';

/** 창 번호가 키에 들어 있어 TTL은 정리용이다 — 창 안 첫 호출에만 건다. */
const INCR_WITH_TTL = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

/**
 * 클라이언트 IP별 고정 창 호출 제한. IP는 trust proxy를 거친 req.ip다.
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
    const policy = this.reflector.get<RateLimitPolicy | undefined>(
      RATE_LIMIT_METADATA_KEY,
      context.getHandler(),
    );
    if (!policy) return true;

    const ip = clientIpOf(requestOfContext(context));
    const window = Math.floor(
      this.clock.now().getTime() / 1000 / policy.windowSeconds,
    );
    let count: number;
    try {
      count = Number(
        await this.redis.eval(
          INCR_WITH_TTL,
          1,
          `rl:${policy.name}:${ip}:${window}`,
          String(policy.windowSeconds),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `레이트리밋 확인 실패(${policy.name}) — 통과시킴: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
    if (count > policy.limit) throw new DomainException('RATE_LIMITED');
    return true;
  }
}
