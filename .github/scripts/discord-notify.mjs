#!/usr/bin/env node

// Discord Webhook 알림 메인 스크립트
// GitHub Actions에서 실행되며, 이벤트를 판별하고 Discord로 알림을 보낸다.

import { readFile } from 'node:fs/promises';
import { resolveEventType, buildEmbed, buildWebhookBody } from './discord-notify-lib.mjs';

// ── 환경변수 ──

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return value;
}

// ── 메인 ──

async function main() {
  const webhookUrl = getRequiredEnv('DISCORD_WEBHOOK_URL');
  const eventName = getRequiredEnv('GITHUB_EVENT_NAME');
  const eventPath = getRequiredEnv('GITHUB_EVENT_PATH');
  const repository = getRequiredEnv('GITHUB_REPOSITORY');
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';

  // 이벤트 payload 로드
  const rawPayload = await readFile(eventPath, 'utf-8');
  const payload = JSON.parse(rawPayload);

  // 이벤트 타입 판별
  const eventType = resolveEventType(eventName, payload);

  if (!eventType) {
    console.log(`[discord-notify] skip: not a notifiable event (${eventName})`);
    return;
  }

  console.log(`[discord-notify] event detected: ${eventType}`);

  // Embed 생성
  const meta = { repository, serverUrl };
  const embed = buildEmbed(eventType, payload, meta);
  const body = buildWebhookBody(embed);

  // Discord webhook 호출
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => 'unknown');
    throw new Error(
      `Discord webhook failed: ${response.status} ${response.statusText} - ${responseText}`,
    );
  }

  console.log(`[discord-notify] notification sent successfully (${eventType})`);
}

main().catch((error) => {
  console.error('[discord-notify] fatal:', error.message ?? error);
  process.exit(1);
});
