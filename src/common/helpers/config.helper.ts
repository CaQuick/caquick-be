import type { ConfigService } from '@nestjs/config';

/**
 * 필수 환경변수를 가져온다 (없으면 에러)
 *
 * @param config ConfigService
 * @param key 환경변수 키
 * @returns 환경변수 값
 */
export function mustGetEnv(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

/**
 * 환경변수를 숫자로 파싱 (실패 시 기본값 반환)
 *
 * @param config ConfigService
 * @param key 환경변수 키
 * @param defaultValue 기본값
 * @returns 숫자 값
 */
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

/**
 * 환경변수를 불리언으로 파싱
 *
 * @param config ConfigService
 * @param key 환경변수 키
 * @param defaultValue 기본값
 * @returns 불리언 값
 */
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
