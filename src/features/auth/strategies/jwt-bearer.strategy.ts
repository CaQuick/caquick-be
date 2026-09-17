import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { AuthConfig } from '@/config/auth.config';
import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import type { AccessTokenPayload, JwtUser } from '@/global/auth';

/**
 * Bearer 기반 JWT 인증 전략
 */
@Injectable()
export class JwtBearerStrategy extends PassportStrategy(Strategy, 'jwt') {
  /**
   * @param config ConfigService
   * @param accounts AccountRepository
   */
  constructor(
    config: ConfigService,
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accounts: IAccountRepository,
  ) {
    // 시크릿 해석(폴백·공백·prod fail-fast)은 authConfig가 단일 소스다.
    const { jwtSecret } = config.getOrThrow<AuthConfig>('auth');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
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

    const account = await this.accounts.findAccountForJwt(accountId);

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
      // 자격증명 계정(SELLER/ADMIN)만 값이 있다. RolesGuard가 변경 전 접근을 막는다.
      mustChangePassword: account.credential?.must_change_password ?? false,
    };
  }
}
