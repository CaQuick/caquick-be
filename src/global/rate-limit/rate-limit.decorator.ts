import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import {
  RATE_LIMIT_METADATA_KEY,
  RateLimitGuard,
  type RateLimitPolicy,
} from '@/global/rate-limit/rate-limit.guard';

/**
 * 정책과 가드를 함께 건다 — 한쪽만 걸려 제한이 조용히 빠지는 일이 없게. 정책은 하나여도 배열로 저장한다.
 * 가드는 핸들러의 정책만 읽으므로 메서드 전용이다(클래스에 걸면 컴파일 오류).
 */
export const RateLimit = (...policies: RateLimitPolicy[]): MethodDecorator =>
  applyDecorators(
    SetMetadata(RATE_LIMIT_METADATA_KEY, policies),
    UseGuards(RateLimitGuard),
  );
