import { registerAs } from '@nestjs/config';

export interface AppConfigDatabase {
  host: string;
  port: number;
  username: string;
  password: string;
  name: string;
}

export interface AppConfig {
  database: AppConfigDatabase;
  auth: {
    jwtSecret: string;
  };
}

/**
 * 애플리케이션 전역 설정을 env에서 읽어오는 팩토리 함수.
 */
export default registerAs('app', (): AppConfig => {
  const toNumber = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    database: {
      host: process.env.DB_HOST ?? 'localhost',
      port: toNumber(process.env.DB_PORT, 3306),
      username: process.env.DB_USERNAME ?? process.env.DB_USER ?? '',
      password: process.env.DB_PASSWORD ?? '',
      name: process.env.DB_NAME ?? '',
    },
    auth: {
      jwtSecret:
        process.env.JWT_ACCESS_SECRET ??
        process.env.JWT_SECRET ??
        'dev_jwt_secret',
    },
  };
});
