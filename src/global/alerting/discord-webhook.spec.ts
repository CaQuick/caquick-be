import { hostname } from 'node:os';

import { buildDiscordPayload } from '@/global/alerting/discord-webhook';

describe('buildDiscordPayload', () => {
  const at = new Date('2026-09-24T12:00:00.000Z');

  it('레벨 접두·본문·색·출처 푸터·시각을 embed 1개로 만든다', () => {
    const payload = buildDiscordPayload(
      { level: 'error', title: 'outbox FAILED', detail: 'x#1 5회 실패' },
      { role: 'worker', env: 'production' },
      at,
    );

    expect(payload).toEqual({
      username: 'caquick-be',
      embeds: [
        {
          title: '[error] outbox FAILED',
          description: 'x#1 5회 실패',
          color: 0xef4444,
          footer: { text: `production · worker · ${hostname()}` },
          timestamp: '2026-09-24T12:00:00.000Z',
        },
      ],
    });
  });

  it('반증: 긴 본문은 Discord 한도 아래로 자른다', () => {
    const payload = buildDiscordPayload(
      { level: 'warn', title: 't', detail: 'a'.repeat(5_000) },
      { role: 'api', env: 'test' },
      at,
    ) as { embeds: Array<{ description: string; color: number }> };

    expect(payload.embeds[0].description).toHaveLength(1_800);
    expect(payload.embeds[0].color).toBe(0xf59e0b);
  });
});
