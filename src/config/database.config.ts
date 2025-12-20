import { registerAs } from '@nestjs/config';

/**
 * 데이터베이스 설정 타입
 */
export interface DatabaseConfig {
  url: string;
}

/**
 * 데이터베이스 설정
 */
export default registerAs('database', (): DatabaseConfig => {
  const url = process.env.DATABASE_URL ?? '';

  return {
    url,
  };
});
