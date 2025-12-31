import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AUTH_COOKIE } from '../../../features/auth/auth.constants';
import type { AccessTokenPayload, JwtUser } from '../types/jwt-payload.type';

/**
 * 쿠키 기반 JWT 인증 전략
 *
 * - 우선순위: Cookie -> Authorization Bearer
 */
@Injectable()
export class JwtCookieStrategy extends PassportStrategy(Strategy, 'jwt') {
  /**
   * @param config ConfigService
   */
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret || secret.trim().length === 0) {
      throw new Error('Missing JWT_ACCESS_SECRET');
    }

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request | undefined) => {
          const cookies: unknown = req?.cookies;

          if (!cookies || typeof cookies !== 'object') return null;

          const token = (cookies as Record<string, unknown>)[
            AUTH_COOKIE.ACCESS
          ];
          return typeof token === 'string' ? token : null;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),

      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * payload 검증 후 req.user로 주입할 값을 반환한다.
   *
   * @param payload AccessTokenPayload
   */
  validate(payload: AccessTokenPayload): JwtUser {
    if (!payload?.sub || payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid access token.');
    }
    return { accountId: payload.sub };
  }
}
