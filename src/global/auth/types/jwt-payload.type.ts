/**
 * Access Token(JWT) Payload 타입
 */
export interface AccessTokenPayload {
  /** 계정 ID */
  sub: string;

  /** 토큰 타입 */
  typ: 'access';

  /** 발급 시각 */
  iat: number;

  /** 만료 시각 */
  exp: number;
}

/**
 * JWT Strategy가 validate 이후 req.user에 심을 유저 타입
 */
export interface JwtUser {
  accountId: string;
}
