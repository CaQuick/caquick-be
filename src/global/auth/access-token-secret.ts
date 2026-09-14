import type { ConfigService } from '@nestjs/config';

/**
 * access token 서명·검증에 쓰는 시크릿의 ConfigService 조회 키.
 *
 * `auth.config.ts`가 `JWT_ACCESS_SECRET ?? JWT_SECRET` 폴백을 이미 해석해 두므로,
 * 소비처는 raw 환경변수가 아니라 이 해석값 하나만 본다.
 * (raw `JWT_ACCESS_SECRET`을 각자 읽던 시절 `JWT_SECRET`만 설정한 배포가
 *  config 검증은 통과하고 모듈 생성에서 죽는 회귀가 있었다.)
 */
export const ACCESS_TOKEN_SECRET_CONFIG_KEY = 'auth.jwtSecret';

export const ACCESS_TOKEN_SECRET_MISSING_MESSAGE =
  'Missing JWT access token secret. Set JWT_ACCESS_SECRET (or JWT_SECRET).';

/**
 * 해석된 access token 시크릿을 반환한다. 없거나 공백뿐이면 fail-fast.
 *
 * authConfig가 로드되지 않은 컨텍스트(ConfigModule 없이 조립된 모듈 등)에서도
 * 조용히 빈 값으로 서명하지 않도록 방어한다.
 */
export function resolveAccessTokenSecret(config: ConfigService): string {
  const secret = config.get<string>(ACCESS_TOKEN_SECRET_CONFIG_KEY)?.trim();

  if (!secret) {
    throw new Error(ACCESS_TOKEN_SECRET_MISSING_MESSAGE);
  }

  return secret;
}
