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
    // 키 해석과 iss/aud는 authConfig가 단일 소스다. 검증은 공개키로만 하고 알고리즘을 RS256으로 고정한다
    // (alg 혼동 공격 차단 — HS256 토큰을 공개키로 검증하게 두지 않는다).
    const auth = config.getOrThrow<AuthConfig>('auth');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: auth.jwtKeys.publicKeyPem,
      algorithms: ['RS256'],
      issuer: auth.jwtIssuer,
      audience: auth.jwtAudience,
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
