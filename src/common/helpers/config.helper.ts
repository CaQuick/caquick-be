import type { ConfigService } from '@nestjs/config';

export function mustGetEnv(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

export function getEnvAsNumber(
  config: ConfigService,
  key: string,
  defaultValue: number,
): number {
  const value = config.get<string>(key);
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function getEnvAsBoolean(
  config: ConfigService,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = config.get<string>(key);
  if (!value) return defaultValue;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return defaultValue;
}
