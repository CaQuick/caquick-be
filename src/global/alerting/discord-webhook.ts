import { hostname } from 'node:os';

import { withTimeout } from '@/common/utils/with-timeout';

export type AlertLevel = 'warn' | 'error';

export interface AlertMessage {
  level: AlertLevel;
  title: string;
  detail?: string;
  /** 억제 단위. 없으면 title. 같은 key는 억제 창 안에서 한 번만 나간다. */
  key?: string;
}

export interface AlertOrigin {
  role: string;
  env: string;
}

/** 전송 함수 계약 — 서비스는 이 형태만 알고, 실제 HTTP는 postDiscordAlert가 한다(테스트는 가짜를 넣는다). */
export type AlertTransport = (
  webhookUrl: string,
  message: AlertMessage,
  origin: AlertOrigin,
) => Promise<boolean>;

export const ALERT_TRANSPORT = Symbol('ALERT_TRANSPORT');

/** Discord 웹훅 전송 상한 — 경보 때문에 요청·소비가 매달리면 안 된다. */
export const ALERT_POST_TIMEOUT_MS = 3_000;
const DESCRIPTION_LIMIT = 1_800;
const COLOR: Record<AlertLevel, number> = { warn: 0xf59e0b, error: 0xef4444 };

export function buildDiscordPayload(
  message: AlertMessage,
  origin: AlertOrigin,
  at: Date,
): Record<string, unknown> {
  return {
    username: 'caquick-be',
    embeds: [
      {
        title: `[${message.level}] ${message.title}`,
        description: message.detail?.slice(0, DESCRIPTION_LIMIT),
        color: COLOR[message.level],
        footer: { text: `${origin.env} · ${origin.role} · ${hostname()}` },
        timestamp: at.toISOString(),
      },
    ],
  };
}

/** 실패해도 던지지 않는다 — 경보 실패는 호출자가 로그로만 남긴다. */
export const postDiscordAlert: AlertTransport = async (
  webhookUrl,
  message,
  origin,
) => {
  try {
    const response = await withTimeout(
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildDiscordPayload(message, origin, new Date())),
      }),
      ALERT_POST_TIMEOUT_MS,
      'discord webhook',
    );
    return response.ok;
  } catch {
    return false;
  }
};
