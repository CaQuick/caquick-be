import { registerAs } from '@nestjs/config';

import {
  parseEnvBoolean,
  parseEnvNumber,
  parseEnvString,
} from '@/common/utils/env-parse';

export interface ExpoPushConfig {
  /** 꺼져 있으면 소비자가 전송 없이 ack만 한다(이력도 남기지 않는다). 기본 false. */
  enabled: boolean;
  /** Expo 액세스 토큰(선택). 있으면 Authorization: Bearer. */
  accessToken: string | null;
  requestTimeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/** 선택 설정 — 부팅을 막는 조건이 없다. 비표준 값은 기본값으로 떨어진다. */
export function readExpoPushConfig(
  env: NodeJS.ProcessEnv = process.env,
): ExpoPushConfig {
  return {
    enabled: parseEnvBoolean(env.EXPO_PUSH_ENABLED, false),
    accessToken: parseEnvString(env.EXPO_PUSH_ACCESS_TOKEN) ?? null,
    requestTimeoutMs: parseEnvNumber(
      env.EXPO_PUSH_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    ),
  };
}

export default registerAs('expoPush', (): ExpoPushConfig =>
  readExpoPushConfig(),
);
