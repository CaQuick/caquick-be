import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { domainError } from '@/common/errors';
import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import {
  type AccessTokenPayload,
  type JwtUser,
  resolveAccessTokenSecret,
} from '@/global/auth';

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
    const secret = resolveAccessTokenSecret(config);

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
      throw domainError('INVALID_ACCESS_TOKEN');
    }

    let accountId: bigint;
    try {
      accountId = BigInt(payload.sub);
    } catch {
      throw domainError('INVALID_ACCESS_TOKEN');
    }

    const account = await this.accounts.findAccountForJwt(accountId);

    // 존재하지 않거나 deleted_at이 찍힌 경우
    if (!account) {
      throw domainError('ACCOUNT_NOT_FOUND');
    }

    if (account.status !== 'ACTIVE') {
      throw domainError('ACCOUNT_NOT_ACTIVE');
    }

    return {
      accountId: account.id.toString(),
      accountType: account.account_type,
      // 자격증명 계정(SELLER/ADMIN)만 값이 있다. RolesGuard가 변경 전 접근을 막는다.
      mustChangePassword: account.credential?.must_change_password ?? false,
    };
  }
}
