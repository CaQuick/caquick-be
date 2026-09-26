import { timingSafeEqual } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import type { MetricsConfig } from '@/config/metrics.config';

/**
 * /metrics 접근 토큰(Authorization: Bearer). 토큰이 없는 환경(로컬·CI)은 연다 — 운영은 metrics.config가 토큰을 강제한다.
 * Prometheus는 `authorization: { credentials_file }`로 같은 값을 보낸다(09).
 */
@Injectable()
export class MetricsAccessMiddleware implements NestMiddleware {
  private readonly accessToken: string | null;

  constructor(config: ConfigService) {
    this.accessToken = config.getOrThrow<MetricsConfig>('metrics').accessToken;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.accessToken) {
      next();
      return;
    }
    const provided = bearerToken(req.headers.authorization);
    if (provided !== null && isSameToken(provided, this.accessToken)) {
      next();
      return;
    }
    res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"');
    res.status(401).json({ message: 'Unauthorized' });
  }
}

function bearerToken(header?: string): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || !value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim();
}

/** 길이가 다르면 비교 자체가 타이밍을 새지 않게 같은 길이의 더미와 비교한다. */
function isSameToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}
