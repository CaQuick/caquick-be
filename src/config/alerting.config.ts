import { registerAs } from '@nestjs/config';

import { parseEnvNumber, parseEnvString } from '@/common/utils/env-parse';

export interface AlertingConfig {
  /** 미설정이면 경보는 로그로만 남긴다 — 로컬·CI에서 웹훅을 강제하지 않는다. */
  discordWebhookUrl: string | null;
  /** 같은 key의 경보를 이 시간 안에는 한 번만 보낸다(장애 중 폭주 방지). */
  dedupeWindowMs: number;
}

export const ALERT_DEDUPE_WINDOW_DEFAULT_MS = 5 * 60_000;

/** registerAs와 부팅 실패 경로(DI 밖)가 같은 규칙으로 읽도록 순수 함수로 둔다. */
export function readAlertingConfig(
  env: NodeJS.ProcessEnv = process.env,
): AlertingConfig {
  return {
    discordWebhookUrl: parseEnvString(env.DISCORD_ALERT_WEBHOOK_URL) ?? null,
    dedupeWindowMs: parseEnvNumber(
      env.ALERT_DEDUPE_WINDOW_MS,
      ALERT_DEDUPE_WINDOW_DEFAULT_MS,
    ),
  };
}

export default registerAs('alerting', (): AlertingConfig =>
  readAlertingConfig(),
);
