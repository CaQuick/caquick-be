import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AccessTokenPayload, JwtUser } from '../../../global/auth';
import { AuthRepository } from '../repositories/auth.repository';

/**
 * Bearer 기반 JWT 인증 전략
 */
@Injectable()
export class JwtBearerStrategy extends PassportStrategy(Strategy, 'jwt') {
  /**
   * @param config ConfigService
   * @param repo AuthRepository
   */
  constructor(
    config: ConfigService,
    private readonly repo: AuthRepository,
  ) {
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
   * - 토큰 형식 검증
   * - DB에서 계정 존재/상태/탈퇴(deleted_at) 여부 검증
   *
   * @param payload AccessTokenPayload
   */
  async validate(payload: AccessTokenPayload): Promise<JwtUser> {
    if (!payload?.sub || payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid access token.');
    }

    let accountId: bigint;
    try {
      accountId = BigInt(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid access token.');
    }

    const account = await this.repo.findAccountForJwt(accountId);

    // 존재하지 않거나 deleted_at이 찍힌 경우
    if (!account) {
      throw new UnauthorizedException('Account not found.');
    }

    if (account.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active.');
    }

    return {
      accountId: account.id.toString(),
      accountType: account.account_type,
    };
  }
}
