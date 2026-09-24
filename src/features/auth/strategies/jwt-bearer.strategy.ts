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
import { AlertService } from '@/global/alerting';
import type { AccessTokenPayload, JwtUser } from '@/global/auth';
import {
  type BlockReason,
  TokenBlacklistService,
} from '@/global/auth/blacklist';

@Injectable()
export class JwtBearerStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accounts: IAccountRepository,
    private readonly blacklist: TokenBlacklistService,
    private readonly alerts: AlertService,
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

  /**
   * 정상 경로는 DB를 읽지 않는다(P2 E2): 서명이 유효한 토큰의 클레임(role·mustChangePassword)을 신뢰하고,
   * 정지·탈퇴·비밀번호 변경은 Redis 블랙리스트가 막는다. Redis 조회가 실패하면 예전 방식(계정 재조회)으로
   * 폴백하고 경보를 남긴다 — 모놀리스는 DB가 바로 옆이라 열어 둘 이유가 없다.
   */
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

    let reason: BlockReason | null;
    try {
      reason = await this.blacklist.blockedReason(accountId);
    } catch (error) {
      void this.alerts.notify({
        level: 'warn',
        title: 'Redis 블랙리스트 조회 실패 — 계정 재조회로 폴백',
        key: 'auth-blacklist-fallback',
        detail: error instanceof Error ? error.message : String(error),
      });
      return this.validateAgainstDb(accountId);
    }

    if (reason === 'CREDENTIAL_CHANGED') {
      throw new DomainException('INVALID_ACCESS_TOKEN');
    }
    if (reason !== null) {
      throw new DomainException('ACCOUNT_NOT_ACTIVE');
    }

    return {
      accountId: payload.sub,
      accountType: payload.role,
      mustChangePassword: payload.mustChangePassword ?? false,
    };
  }

  /** 폴백 경로 — 블랙리스트 도입 전과 같은 판정(존재·ACTIVE·must_change_password). */
  private async validateAgainstDb(accountId: bigint): Promise<JwtUser> {
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
      mustChangePassword: account.credential?.must_change_password ?? false,
    };
  }
}
