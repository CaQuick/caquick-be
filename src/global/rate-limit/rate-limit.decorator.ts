import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import {
  RATE_LIMIT_METADATA_KEY,
  RateLimitGuard,
  type RateLimitPolicy,
} from '@/global/rate-limit/rate-limit.guard';

/** 정책과 가드를 함께 건다 — 한쪽만 걸려 제한이 조용히 빠지는 일이 없게. */
export const RateLimit = (
  policy: RateLimitPolicy,
): ReturnType<typeof applyDecorators> =>
  applyDecorators(
    SetMetadata(RATE_LIMIT_METADATA_KEY, policy),
    UseGuards(RateLimitGuard),
  );
