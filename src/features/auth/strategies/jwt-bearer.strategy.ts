import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { DomainException } from '@/common/errors/error-catalog';
import type { AuthConfig } from '@/config/auth.config';
import {
  ACCOUNT_REPOSITORY,
  type IAccountRepository,
} from '@/features/auth/repositories/account.repository.interface';
import type { AccessTokenPayload, JwtUser } from '@/global/auth';

@Injectable()
export class JwtBearerStrategy extends PassportStrategy(Strategy, 'jwt') {
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

  async validate(payload: AccessTokenPayload): Promise<JwtUser> {
    if (!payload?.sub || payload.typ !== 'access') {
      throw new DomainException('INVALID_ACCESS_TOKEN');
    }

    let accountId: bigint;
    try {
      accountId = BigInt(payload.sub);
    } catch {
      throw new DomainException('INVALID_ACCESS_TOKEN');
    }

    const account = await this.accounts.findAccountForJwt(accountId);

    if (!account) {
      throw new DomainException('SESSION_ACCOUNT_MISSING');
    }

    if (account.status !== 'ACTIVE') {
      throw new DomainException('ACCOUNT_NOT_ACTIVE');
    }

    return {
      accountId: account.id.toString(),
      accountType: account.account_type,
      // 자격증명 계정(SELLER/ADMIN)만 값이 있다. RolesGuard가 변경 전 접근을 막는다.
      mustChangePassword: account.credential?.must_change_password ?? false,
    };
  }
}
