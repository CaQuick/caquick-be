import { registerAs } from '@nestjs/config';

/**
 * 인증 설정 타입
 */
export interface AuthConfig {
  jwtSecret: string;
}

/**
 * 인증 설정
 */
export default registerAs('auth', (): AuthConfig => {
  const isProd = process.env.NODE_ENV === 'production';
  const jwtSecret =
    process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? '';

  if (isProd && !jwtSecret) {
    throw new Error(
      'JWT_SECRET or JWT_ACCESS_SECRET must be set in production environment',
    );
  }

  return {
    jwtSecret: jwtSecret || 'dev_jwt_secret',
  };
});
