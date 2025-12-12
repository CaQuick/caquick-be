import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

import type { AppConfig } from 'src/config/app.config';

/**
 * TypeORM 설정을 생성하는 팩토리 함수.
 *
 * @param configService 환경 변수 접근용 ConfigService
 * @returns TypeORM 모듈 옵션
 */
export const typeOrmConfigFactory = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  const appConfig = configService.get<AppConfig>('app');
  const dbConfig = appConfig?.database;

  const toNumber = (value: unknown, fallback: number): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  const host =
    dbConfig?.host ??
    configService.get<string>('DB_HOST') ??
    configService.get<string>('DB_HOSTNAME') ??
    'localhost';
  const port =
    dbConfig?.port ??
    toNumber(
      configService.get<string>('DB_PORT') ??
        configService.get<number>('DB_PORT'),
      3306,
    );
  const username =
    dbConfig?.username ??
    configService.get<string>('DB_USERNAME') ??
    configService.get<string>('DB_USER') ??
    '';
  const password =
    dbConfig?.password ?? configService.get<string>('DB_PASSWORD') ?? '';
  const database = dbConfig?.name ?? configService.get<string>('DB_NAME') ?? '';

  return {
    type: 'mysql',
    host,
    port,
    username,
    password,
    database,
    autoLoadEntities: true,
    synchronize: false,
    // logging: !isProd,
  };
};
