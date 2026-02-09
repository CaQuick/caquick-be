import { timingSafeEqual } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

/**
 * 문서 접근 전용 토큰 가드 미들웨어.
 * - Authorization: Bearer <token>
 * - Authorization: Basic <base64(user:token)>
 */
@Injectable()
export class DocsAccessMiddleware implements NestMiddleware {
  private readonly accessToken: string | null;

  constructor(private readonly configService: ConfigService) {
    const token =
      this.configService.get<string>('docs.accessToken')?.trim() ?? '';
    this.accessToken = token.length > 0 ? token : null;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.accessToken) {
      next();
      return;
    }

    const providedToken = extractTokenFromAuthHeader(req.headers.authorization);

    if (providedToken && isSameToken(providedToken, this.accessToken)) {
      next();
      return;
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="Docs"');
    res.status(401).json({ message: 'Unauthorized' });
  }
}

function extractTokenFromAuthHeader(header?: string): string | null {
  if (!header) return null;

  const [scheme, value] = header.split(' ');
  if (!scheme || !value) return null;

  const lowerScheme = scheme.toLowerCase();
  if (lowerScheme === 'bearer') return value.trim();

  if (lowerScheme === 'basic') {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;
    return decoded.slice(separatorIndex + 1);
  }

  return null;
}

function isSameToken(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
