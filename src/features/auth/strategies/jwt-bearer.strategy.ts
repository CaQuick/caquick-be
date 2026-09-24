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
  type BlacklistLookup,
  credentialCutoffSec,
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
   * 정지·탈퇴·비밀번호 변경은 Redis 블랙리스트가 막는다. 블랙리스트가 불완전하거나(재구축 표식 없음 — Redis 초기화)
   * 조회가 실패하면 예전 방식(계정 재조회)으로 폴백한다 — 모놀리스는 DB가 바로 옆이라 열어 둘 이유가 없다.
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

    let lookup: BlacklistLookup;
    try {
      lookup = await this.blacklist.lookup(accountId);
    } catch (error) {
      void this.alerts.notify({
        level: 'warn',
        title: 'Redis 블랙리스트 조회 실패 — 계정 재조회로 폴백',
        key: 'auth-blacklist-fallback',
        detail: error instanceof Error ? error.message : String(error),
      });
      return this.validateAgainstDb(accountId, payload.iat);
    }
    if (!lookup.ready) {
      // Redis가 비었다(초기화·flush). worker 재구축이 표식을 다시 세울 때까지 DB가 정본이다.
      // 요청마다 타는 분기라 직접 로그는 두지 않는다 — 경보가 억제 창(5분)으로 1회만 남긴다.
      void this.alerts.notify({
        level: 'warn',
        title: 'Redis 블랙리스트 미구축 — 계정 재조회로 폴백',
        key: 'auth-blacklist-not-ready',
      });
      return this.validateAgainstDb(accountId, payload.iat);
    }

    if (lookup.status !== null) {
      // 탈퇴는 DB 경로(soft-delete 필터에 걸려 "없음")와 같은 코드 — Redis를 타든 안 타든 응답이 같아야 한다
      throw new DomainException(
        lookup.status === 'DELETED'
          ? 'SESSION_ACCOUNT_MISSING'
          : 'ACCOUNT_NOT_ACTIVE',
      );
    }
    // iat와 cutoff 둘 다 초 단위 — 변경 전에 발급된 토큰만 무효
    if (
      lookup.credentialCutoffSec !== null &&
      payload.iat < lookup.credentialCutoffSec
    ) {
      throw new DomainException('INVALID_ACCESS_TOKEN');
    }

    return {
      accountId: payload.sub,
      accountType: payload.role,
      mustChangePassword: payload.mustChangePassword ?? false,
    };
  }

  /** 폴백 경로 — 블랙리스트 도입 전 판정(존재·ACTIVE·must_change_password)에 자격증명 변경 시각 비교를 더한다. */
  private async validateAgainstDb(
    accountId: bigint,
    issuedAtSec: number,
  ): Promise<JwtUser> {
    const account = await this.accounts.findAccountForJwt(accountId);

    if (!account) {
      throw new DomainException('SESSION_ACCOUNT_MISSING');
    }

    if (account.status !== 'ACTIVE') {
      throw new DomainException('ACCOUNT_NOT_ACTIVE');
    }

    const changedAt = account.credential?.password_updated_at;
    if (changedAt && issuedAtSec < credentialCutoffSec(changedAt)) {
      throw new DomainException('INVALID_ACCESS_TOKEN');
    }

    return {
      accountId: account.id.toString(),
      accountType: account.account_type,
      mustChangePassword: account.credential?.must_change_password ?? false,
    };
  }
}
