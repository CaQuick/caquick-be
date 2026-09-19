import type { ConfigService } from '@nestjs/config';

import { parseEnvBoolean, parseEnvNumber } from '@/common/utils/env-parse';

export function mustGetEnv(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

/** 파싱 규칙은 registerAs(process.env)와 한 벌을 쓴다 — @/common/utils/env-parse. */
export function getEnvAsNumber(
  config: ConfigService,
  key: string,
  defaultValue: number,
): number {
  return parseEnvNumber(config.get<string>(key), defaultValue);
}

export function getEnvAsBoolean(
  config: ConfigService,
  key: string,
  defaultValue: boolean,
): boolean {
  return parseEnvBoolean(config.get<string>(key), defaultValue);
}
