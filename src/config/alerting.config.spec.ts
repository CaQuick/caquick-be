import {
  ALERT_DEDUPE_WINDOW_DEFAULT_MS,
  readAlertingConfig,
} from '@/config/alerting.config';

describe('alertingConfig', () => {
  it('미설정이면 웹훅 없음(로그만) + 5분 억제', () => {
    expect(readAlertingConfig({})).toEqual({
      discordWebhookUrl: null,
      dedupeWindowMs: ALERT_DEDUPE_WINDOW_DEFAULT_MS,
    });
  });

  it('env를 읽고 공백만 있는 웹훅은 미설정으로 본다', () => {
    expect(
      readAlertingConfig({
        DISCORD_ALERT_WEBHOOK_URL: ' https://discord.com/api/webhooks/1/x ',
        ALERT_DEDUPE_WINDOW_MS: '1000',
      }),
    ).toEqual({
      discordWebhookUrl: 'https://discord.com/api/webhooks/1/x',
      dedupeWindowMs: 1000,
    });
    expect(
      readAlertingConfig({ DISCORD_ALERT_WEBHOOK_URL: '   ' })
        .discordWebhookUrl,
    ).toBeNull();
  });
});
