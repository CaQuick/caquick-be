import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AccessTokenPayload, JwtUser } from '../types/jwt-payload.type';

/**
 * Bearer 기반 JWT 인증 전략
 */
@Injectable()
export class JwtBearerStrategy extends PassportStrategy(Strategy, 'jwt') {
  /**
   * @param config ConfigService
   */
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret || secret.trim().length === 0) {
      throw new Error('Missing JWT_ACCESS_SECRET');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
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
